// 프롬프트·AI 탭. 프롬프트를 조립해 복사하는 작업대와 AI 도구 연결 현황. 서버 경유 AI 호출과 수동 복사를 함께 지원한다.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import {
  buildPrompt, buildChipPanel, depthRadios, ratioSelect, copyText, sanitizePicks, fragmentsFor,
  NEGATIVE_QUICK, RATIOS, DEPTHS,
} from './prompt-kit.js';

const SEED_MAX = 2147483647;

export const AI_TOOLS = [
  { name: '이미지 생성 (텍스트→이미지)', desc: '프롬프트로 새 이미지를 만듭니다.', local: '지금은 이 작업대에서 프롬프트를 만들어 복사할 수 있습니다.' },
  { name: '참조 이미지 조합 편집', desc: '여러 참조 이미지를 섞어 새 구성을 만듭니다.', local: '이미지 탭의 이미지 레이어로 사진을 직접 배치하는 합성 보드를 쓸 수 있습니다.' },
  { name: '애니→실사 변환', desc: '그림체 이미지를 사진처럼 바꿉니다.', local: '원본 이미지는 자료함에 보관해 둘 수 있습니다.' },
  { name: '실사→애니 변환', desc: '사진을 그림체로 바꿉니다.', local: '원본 사진은 자료함에 보관해 둘 수 있습니다.' },
  { name: '스케치→완성본 변환', desc: '손 스케치를 고른 화풍의 그림으로 완성합니다.', local: '스케치 그리기·저장은 이미지 탭에서 가능합니다.' },
  { name: '썸네일 AI 보정', desc: '썸네일 사진의 화질·색감을 자동으로 다듬습니다.', local: '문구·외곽선·그림자·배경 편집과 PNG 저장은 이미지 탭에서 가능합니다.' },
  { name: '영상 생성', desc: '이미지와 프롬프트로 짧은 영상을 만듭니다.', local: '장면 순서·길이 계획과 스토리보드 PNG 내보내기는 대본·장면 탭에서 가능합니다.' },
  { name: '음성·립싱크·배경음악', desc: '내레이션 음성, 입 모양 맞춤, 배경음악을 입힙니다.', local: '장면별 내레이션 원고는 대본·장면 탭에 정리할 수 있습니다.' },
];

function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] & SEED_MAX;
}

/**
 * @param {HTMLElement} root
 * @param {{ getState: () => any, markDirty: () => void, notify: Function, aiBlocked: Function, confirm: Function, switchTab?: (id: string) => void }} ctx
 */
export function renderPromptLab(root, ctx) {
  clear(root);
  const state = ctx.getState();
  if (!state.promptLab || typeof state.promptLab !== 'object') {
    state.promptLab = { picks: {}, subject: '', negative: '', ratio: '16:9', depth: 'auto', seed: null, characterIds: [] };
  }
  const pl = state.promptLab;
  pl.picks = sanitizePicks(pl.picks);
  if (!RATIOS.includes(pl.ratio)) pl.ratio = '16:9';
  if (!DEPTHS.some((d) => d.id === pl.depth)) pl.depth = 'auto';
  const characters = (state.story && Array.isArray(state.story.characters)) ? state.story.characters : [];
  pl.characterIds = (pl.characterIds || []).filter((id) => characters.some((c) => c.id === id));

  const changed = () => { ctx.markDirty(); update(); };
  const refs = new Set();
  const generated = h('div', { class: 'pl-generated', role: 'status', 'aria-live': 'polite' });
  const imageTools = [
    '',
    'Compose a coherent new image using the selected reference images. Preserve the identity of the main subject.',
    'Convert the reference illustration into a photorealistic photograph, preserving composition and identity.',
    'Convert the reference photograph into an anime illustration, preserving composition and identity.',
    'Turn the reference sketch into a finished illustration, preserving the original composition.',
    'Improve the reference image for a clear, compelling thumbnail. Preserve identity and factual product appearance.',
  ];
  function generateButton(label, index = 0, small = false) {
    const btn = h('button', { type: 'button', class: 'btn btn-ai' + (small ? ' btn-sm' : ''), onclick: async () => {
      if (!ctx.ai?.ready('openai')) { ctx.ai?.open(); return; }
      if (btn.disabled) return;
      update();
      if (!index && !last.positive.trim()) { ctx.notify('장면 묘사나 스타일을 먼저 입력해 주세요.', 'error'); return; }
      if (index && !refs.size) { ctx.notify('참조 이미지를 한 장 이상 선택해 주세요.', 'error'); return; }
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      try {
        const parts = String(pl.ratio).split(':').map(Number);
        const result = await ctx.ai.image({ prompt: [imageTools[index], last.positive, last.negative ? 'Avoid: ' + last.negative : '', 'Requested composition ratio: ' + pl.ratio].filter(Boolean).join('\n'), assetIds: [...refs],
          size: parts[0] === parts[1] ? '1024x1024' : parts[0] > parts[1] ? '1536x1024' : '1024x1536' });
        if (!result?.asset) return;
        clear(generated);
        generated.append(h('p', null, '생성 이미지를 자료함에 저장했습니다. 이미지 탭에서 배경·레이어로 선택할 수 있습니다.'), h('img', { src: '/api/assets/' + encodeURIComponent(result.asset.id), alt: 'AI 생성 결과', style: 'max-width:100%;max-height:420px;object-fit:contain;' }));
        ctx.notify('이미지를 생성해 자료함에 보관했습니다.', 'success');
      } catch (err) { ctx.notify(err.message || '이미지 생성에 실패했습니다.', 'error'); }
      finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
    } }, icon('plug', 'icon-sm'), h('span', null, label), h('span', { class: 'badge' }, ctx.ai?.ready('openai') ? 'API' : '키 설정'));
    return btn;
  }
  const refBox = h('div', { class: 'pk-charbox', role: 'group', 'aria-label': 'AI 참조 이미지 선택' });
  for (const a of (ctx.getAssets?.() || []).filter((a) => ['image/png', 'image/jpeg', 'image/webp'].includes(a.mime))) {
    const cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', () => {
      if (cb.checked && refs.size >= 4) { cb.checked = false; ctx.notify('참조 이미지는 최대 4장입니다.', 'error'); return; }
      if (cb.checked) refs.add(a.id); else refs.delete(a.id);
    });
    refBox.append(h('label', { class: 'check' }, cb, h('span', null, a.name || '이미지')));
  }
  if (!refBox.childElementCount) refBox.append(h('p', { class: 'hint' }, '자료함에 이미지를 올리면 여기에 참조 이미지가 표시됩니다.'));

  // ---------- 결과 영역 ----------
  const posOut = h('pre', { class: 'pl-out', 'aria-live': 'polite' });
  const negOut = h('pre', { class: 'pl-out' });
  const sumOut = h('p', { class: 'pl-out pl-summary' });
  let last = { positive: '', negative: '', summary: '' };

  function allText() {
    const lines = [];
    lines.push(`Positive: ${last.positive || '(비어 있음)'}`);
    if (last.negative) lines.push(`Negative: ${last.negative}`);
    lines.push(`Aspect ratio: ${pl.ratio}`);
    if (pl.seed !== null && pl.seed !== undefined) lines.push(`Seed: ${pl.seed}`);
    return lines.join('\n');
  }

  function update() {
    last = buildPrompt({
      picks: pl.picks, subject: pl.subject, depth: pl.depth, ratio: pl.ratio, negative: pl.negative,
      characters: characters.filter((c) => pl.characterIds.includes(c.id)),
    });
    posOut.textContent = last.positive || '항목을 고르거나 장면 묘사를 적으면 여기에 만들어집니다.';
    negOut.textContent = last.negative || '(제외할 요소 없음)';
    sumOut.textContent = `${last.summary}${pl.seed !== null && pl.seed !== undefined ? ` · 시드: ${pl.seed}` : ' · 시드: 지정 안 함'}`;
  }

  async function copy(text, what) {
    const t = String(text || '').trim();
    if (!t) { ctx.notify(`${what}이(가) 비어 있습니다.`, 'error'); return; }
    const ok = await copyText(t);
    ctx.notify(ok ? `${what}을(를) 복사했습니다.` : '복사하지 못했습니다. 직접 선택해 복사해 주세요.', ok ? 'success' : 'error');
  }

  // ---------- 입력 영역 ----------
  const subject = h('textarea', { id: 'pl-subject', class: 'input', rows: 3, maxLength: 4000, value: pl.subject || '',
    placeholder: '예: 해 질 녘 바닷가 방파제에 앉아 있는 노부부' });
  subject.addEventListener('input', () => { pl.subject = subject.value; changed(); });

  const negative = h('textarea', { id: 'pl-negative', class: 'input', rows: 2, maxLength: 2000, value: pl.negative || '',
    placeholder: '결과에 나오지 않았으면 하는 것 (예: blurry, watermark)' });
  negative.addEventListener('input', () => { pl.negative = negative.value; changed(); });
  const negQuick = h('div', { class: 'pk-chips', role: 'group', 'aria-label': '제외할 요소 빠른 추가' });
  for (const q of NEGATIVE_QUICK) {
    negQuick.append(h('button', { type: 'button', class: 'pk-chip', title: q.en, onclick: () => {
      const cur = String(pl.negative || '').trim();
      if (cur.toLowerCase().includes(q.en.toLowerCase())) { ctx.notify(`"${q.label}"은(는) 이미 들어 있습니다.`, 'info'); return; }
      const next = cur ? `${cur.replace(/,\s*$/, '')}, ${q.en}` : q.en;
      if (next.length > 2000) { ctx.notify('제외할 요소는 2,000자까지 적을 수 있습니다.', 'error'); return; }
      pl.negative = next;
      negative.value = next;
      changed();
    } }, `+ ${q.label}`));
  }

  const seedInput = h('input', { id: 'pl-seed', class: 'input num', type: 'number', min: 0, max: SEED_MAX, step: 1, inputmode: 'numeric',
    value: pl.seed === null || pl.seed === undefined ? '' : String(pl.seed), placeholder: '비워 두면 지정 안 함' });
  seedInput.addEventListener('change', () => {
    const raw = seedInput.value.trim();
    if (!raw) { pl.seed = null; changed(); return; }
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0 || n > SEED_MAX) {
      ctx.notify(`시드는 0부터 ${SEED_MAX.toLocaleString('ko-KR')} 사이의 정수만 쓸 수 있습니다.`, 'error');
      seedInput.value = pl.seed === null || pl.seed === undefined ? '' : String(pl.seed);
      return;
    }
    pl.seed = n;
    seedInput.value = String(n);
    changed();
  });

  const charBox = h('div', { class: 'pk-charbox', role: 'group', 'aria-label': '프롬프트에 넣을 등장인물' });
  if (!characters.length) {
    charBox.append(h('p', { class: 'muted small-text' }, '등록한 등장인물이 없습니다. ',
      typeof ctx.switchTab === 'function'
        ? h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => ctx.switchTab('story') }, '대본·장면 탭에서 추가하기')
        : '대본·장면 탭에서 추가할 수 있습니다.'));
  }
  for (const c of characters) {
    const cb = h('input', { type: 'checkbox', checked: pl.characterIds.includes(c.id) });
    cb.addEventListener('change', () => {
      const set = new Set(pl.characterIds);
      if (cb.checked) set.add(c.id); else set.delete(c.id);
      pl.characterIds = characters.map((x) => x.id).filter((id) => set.has(id));
      changed();
    });
    charBox.append(h('label', { class: 'check' }, cb, h('span', null, c.name || '이름 없음')));
  }

  const applyBtn = h('button', { type: 'button', class: 'btn', onclick: applyToScenes }, icon('scenes', 'icon-sm'), h('span', null, '장면에 일괄 적용'));

  async function applyToScenes() {
    const scenes = (state.story && state.story.scenes) || [];
    const frags = fragmentsFor(pl.picks, ['style', 'shot', 'light', 'mood']);
    if (!scenes.length) { ctx.notify('적용할 장면이 없습니다. 대본·장면 탭에서 장면을 먼저 만드세요.', 'error'); return; }
    if (!frags.length) { ctx.notify('화풍·샷·조명·색감 중 하나 이상을 먼저 고르세요.', 'error'); return; }
    const targets = scenes.filter((s) => !String(s.imagePrompt || '').trim());
    if (!targets.length) { ctx.notify('이미지 프롬프트가 비어 있는 장면이 없습니다. 기존 프롬프트는 바꾸지 않습니다.', 'info'); return; }
    const ok = await ctx.confirm({
      title: '장면에 일괄 적용',
      message: `이미지 프롬프트가 비어 있는 장면 ${targets.length}개에 각 장면의 화면 메모·등장인물과 지금 고른 화풍·샷·조명·색감을 넣습니다. 이미 적힌 프롬프트는 바꾸지 않습니다.`,
      okLabel: '적용',
    });
    if (!ok) return;
    for (const s of targets) {
      const chars = characters.filter((c) => (s.characterIds || []).includes(c.id));
      const r = buildPrompt({
        picks: { style: pl.picks.style || [], shot: pl.picks.shot || [], light: pl.picks.light || [], mood: pl.picks.mood || [] },
        subject: s.prompt || '', characters: chars, depth: 'auto', ratio: null,
      });
      s.imagePrompt = r.positive.slice(0, 4000);
    }
    ctx.markDirty();
    ctx.notify(`장면 ${targets.length}개에 프롬프트를 넣었습니다. 저장해야 서버에 보관됩니다.`, 'success');
  }

  const bench = h('section', { class: 'panel pl-bench', 'aria-labelledby': 'pl-heading' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'pl-heading', class: 'panel-title' }, icon('pen'), '프롬프트 작업대'),
      applyBtn,
    ),
    h('p', { class: 'pl-notice' }, icon('info', 'icon-sm'),
      h('span', null, 'API 키 설정 후 이 프롬프트로 이미지를 생성할 수 있습니다. 생성 전 외부 전송·비용을 확인합니다. 수동 복사도 가능하며, 자유 입력은 그대로 사용합니다.')),
    h('div', { class: 'field' }, h('label', { htmlFor: 'pl-subject' }, '장면 묘사'), subject),
    h('div', { class: 'field' }, h('span', { class: 'label-like' }, '등장인물 (외모 설명을 함께 넣습니다)'), charBox),
    buildChipPanel(pl.picks, changed, { idPrefix: 'pl' }),
    h('div', { class: 'two-col' },
      h('div', { class: 'field' }, h('span', { class: 'label-like' }, '배경 심도'), depthRadios(pl.depth, (v) => { pl.depth = v; changed(); }, 'pl-depth')),
      h('div', { class: 'field' }, h('label', { htmlFor: 'pl-ratio' }, '비율'), ratioSelect(pl.ratio, (v) => { pl.ratio = v; changed(); }, 'pl-ratio')),
    ),
    h('div', { class: 'field' }, h('label', { htmlFor: 'pl-negative' }, '제외할 요소 (Negative)'), negative, negQuick),
    h('div', { class: 'field' },
      h('label', { htmlFor: 'pl-seed' }, '고정 시드'),
      h('div', { class: 'btn-row' },
        seedInput,
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { pl.seed = randomSeed(); seedInput.value = String(pl.seed); changed(); } }, '랜덤 시드 만들기'),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => { pl.seed = null; seedInput.value = ''; changed(); } }, '지우기'),
      ),
      h('p', { class: 'hint' }, '시드는 외부 서비스 복사용입니다. 이 앱의 OpenAI 이미지 호출에는 시드를 보내지 않으므로 재현성을 보장하지 않습니다. 요청 비율은 정사각·가로·세로 중 가까운 생성 크기로 적용합니다.'),
    ),
  );

  const outBox = (label, el, onCopy) => h('div', { class: 'pl-out-box' },
    h('div', { class: 'sb-field-head' },
      h('span', { class: 'label-like' }, label),
      h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: onCopy }, icon('note', 'icon-sm'), h('span', null, '복사')),
    ),
    el,
  );

  const results = h('section', { class: 'panel pl-results', 'aria-labelledby': 'pl-res-heading' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'pl-res-heading', class: 'panel-title' }, icon('check'), '조립 결과'),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => copy(allText(), '프롬프트 전체') }, icon('note', 'icon-sm'), h('span', null, '모두 복사')),
    ),
    outBox('Positive 프롬프트', posOut, () => copy(last.positive, 'Positive 프롬프트')),
    outBox('Negative 프롬프트', negOut, () => copy(last.negative, 'Negative 프롬프트')),
    outBox('설정 요약', sumOut, () => copy(sumOut.textContent, '설정 요약')),
    h('div', { class: 'field' }, h('span', { class: 'label-like' }, '참조 이미지 (선택, 최대 4장)'), refBox),
    generated,
    h('div', { class: 'ai-row' },
      generateButton('이 프롬프트로 생성'),
    ),
  );

  // ---------- AI 도구 연결 현황 ----------
  const toolGrid = h('ul', { class: 'pl-tools', 'aria-label': 'AI 도구 목록' });
  for (const [index, t] of AI_TOOLS.entries()) {
    toolGrid.append(h('li', { class: 'pl-tool' },
      h('div', { class: 'pl-tool-head' },
        h('h3', { class: 'panel-subtitle' }, icon('plug', 'icon-sm'), t.name),
        h('span', { class: 'badge' }, index < 6 ? (ctx.ai?.ready('openai') ? 'API' : '키 필요') : '미구현'),
      ),
      h('p', { class: 'small-text' }, t.desc),
      h('p', { class: 'small-text muted' }, `지금 가능한 것: ${t.local}`),
      index < 6 ? generateButton('이 도구로 생성', index, true) : h('p', { class: 'hint' }, '영상·음성 API는 아직 구현하지 않았습니다. 유료 호출이 일어나지 않습니다.'),
    ));
  }
  const status = h('section', { class: 'panel pl-status', 'aria-labelledby': 'pl-ai-heading' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'pl-ai-heading', class: 'panel-title' }, icon('server'), 'AI 도구 연결 현황'),
      h('span', { class: 'counter' }, `이미지 도구 ${ctx.ai?.ready('openai') ? 6 : 0} / ${AI_TOOLS.length}`),
    ),
    h('p', { class: 'hint' }, icon('info', 'icon-sm'),
      '이미지 도구는 위 작업대의 프롬프트와 선택한 참조 이미지를 함께 사용합니다. 키가 있어도 모델 권한·결제 상태에 따라 실패할 수 있습니다. 영상·음성은 미구현입니다.'),
    toolGrid,
  );

  root.append(h('div', { class: 'pl-wrap' }, h('div', { class: 'pl-grid' }, bench, results), status));
  update();
}
