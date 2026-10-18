// 프롬프트 조립 도구. 고른 항목을 영어 조각으로 이어 붙일 뿐이며 AI 를 호출하지 않는다.
// 자유 입력 문장(한국어 포함)은 번역하지 않고 그대로 넣는다.
import { h, clear, uid } from './dom.js';

/** @type {{id:string,label:string,multi:boolean,options:{id:string,label:string,en:string}[]}[]} */
export const CATEGORIES = [
  {
    id: 'style', label: '화풍', multi: false, options: [
      { id: 'photo', label: '실사 사진', en: 'realistic photograph' },
      { id: 'cinematic', label: '시네마틱 실사', en: 'cinematic film still, realistic' },
      { id: 'anime2d', label: '2D 애니메이션', en: '2D anime illustration, clean line art' },
      { id: 'render3d', label: '3D 렌더', en: '3D render, soft global illumination' },
      { id: 'caricature', label: '캐리커처', en: 'playful caricature, exaggerated features' },
      { id: 'watercolor', label: '수채화', en: 'watercolor painting, soft bleeding edges' },
      { id: 'oil', label: '유화', en: 'oil painting, visible brush strokes' },
      { id: 'inkwash', label: '수묵화', en: 'East Asian ink wash painting' },
      { id: 'webtoon', label: '웹툰', en: 'Korean webtoon style, flat cel shading' },
      { id: 'pixel', label: '픽셀 아트', en: 'pixel art, limited palette' },
      { id: 'clay', label: '클레이 애니메이션', en: 'claymation, handmade clay figures' },
      { id: 'papercut', label: '페이퍼 컷', en: 'layered paper cut-out art' },
      { id: 'stainedglass', label: '스테인드글라스', en: 'stained glass artwork, bold lead lines' },
      { id: 'vintagefilm', label: '빈티지 필름', en: 'vintage analog film photo, grain' },
      { id: 'noir', label: '느와르', en: 'film noir, hard shadows' },
      { id: 'storybook', label: '동화 일러스트', en: "children's storybook illustration" },
    ],
  },
  {
    id: 'shot', label: '샷·앵글', multi: true, options: [
      { id: 'closeup', label: '클로즈업', en: 'close-up shot' },
      { id: 'medium', label: '미디엄 샷', en: 'medium shot' },
      { id: 'full', label: '풀샷', en: 'full body shot' },
      { id: 'wide', label: '와이드 샷', en: 'wide establishing shot' },
      { id: 'low', label: '로우 앵글', en: 'low angle' },
      { id: 'high', label: '하이 앵글', en: 'high angle' },
      { id: 'birdseye', label: '버즈아이', en: "bird's-eye view" },
      { id: 'drone', label: '드론 샷', en: 'aerial drone shot' },
      { id: 'dutch', label: '더치 앵글', en: 'dutch angle' },
      { id: 'ots', label: '오버 더 숄더', en: 'over-the-shoulder shot' },
      { id: 'profile', label: '측면 프로필', en: 'side profile' },
      { id: 'back', label: '뒷모습', en: 'seen from behind' },
    ],
  },
  {
    id: 'camera', label: '카메라', multi: false, options: [
      { id: 'dslr', label: 'DSLR', en: 'shot on a DSLR' },
      { id: 'cinema', label: '시네마 카메라', en: 'shot on a digital cinema camera' },
      { id: 'film35', label: '필름 카메라 35mm', en: 'shot on 35mm film' },
      { id: 'polaroid', label: '폴라로이드', en: 'instant polaroid photo' },
      { id: 'mediumformat', label: '중형 카메라', en: 'medium format camera' },
      { id: 'phone', label: '스마트폰', en: 'smartphone photo' },
    ],
  },
  {
    id: 'lens', label: '렌즈', multi: false, options: [
      { id: 'mm24', label: '24mm 광각', en: '24mm wide-angle lens' },
      { id: 'mm35', label: '35mm', en: '35mm lens' },
      { id: 'mm50', label: '50mm 표준', en: '50mm standard lens' },
      { id: 'mm85', label: '85mm 인물', en: '85mm portrait lens' },
      { id: 'mm135', label: '135mm 망원', en: '135mm telephoto lens' },
      { id: 'macro', label: '매크로', en: 'macro lens' },
      { id: 'fisheye', label: '어안', en: 'fisheye lens' },
    ],
  },
  {
    id: 'placement', label: '피사체 배치', multi: false, options: [
      { id: 'left', label: '왼쪽', en: 'subject placed on the left' },
      { id: 'center', label: '가운데', en: 'subject centered' },
      { id: 'right', label: '오른쪽', en: 'subject placed on the right' },
      { id: 'thirds', label: '삼분할 구도', en: 'rule of thirds composition' },
    ],
  },
  {
    id: 'distance', label: '피사체 거리', multi: false, options: [
      { id: 'fore', label: '전경', en: 'subject in the foreground' },
      { id: 'mid', label: '중경', en: 'subject in the middle ground' },
      { id: 'back', label: '원경', en: 'subject far in the background' },
    ],
  },
  {
    id: 'subject', label: '인물', multi: true, options: [
      { id: 'man', label: '남성', en: 'man' },
      { id: 'woman', label: '여성', en: 'woman' },
      { id: 'child', label: '아이', en: 'child' },
      { id: 'young', label: '청년', en: 'young adult' },
      { id: 'middle', label: '중년', en: 'middle-aged person' },
      { id: 'senior', label: '노년', en: 'elderly person' },
      { id: 'pet', label: '반려동물', en: 'pet animal' },
      { id: 'object', label: '사물 중심', en: 'object-focused still life' },
    ],
  },
  {
    id: 'light', label: '조명·분위기', multi: true, options: [
      { id: 'natural', label: '자연광', en: 'natural daylight' },
      { id: 'golden', label: '골든아워', en: 'golden hour light' },
      { id: 'blue', label: '블루아워', en: 'blue hour twilight' },
      { id: 'studio', label: '스튜디오 조명', en: 'soft studio lighting' },
      { id: 'backlight', label: '역광', en: 'strong backlight, rim light' },
      { id: 'neon', label: '네온', en: 'neon lights' },
      { id: 'candle', label: '촛불', en: 'warm candlelight' },
      { id: 'moon', label: '달빛', en: 'pale moonlight' },
      { id: 'fog', label: '안개', en: 'drifting fog, volumetric light' },
      { id: 'rainnight', label: '비 오는 밤', en: 'rainy night, wet reflections' },
      { id: 'sunset', label: '일몰', en: 'sunset sky' },
      { id: 'underwater', label: '수중 빛', en: 'underwater caustic light' },
    ],
  },
  {
    id: 'mood', label: '색감', multi: false, options: [
      { id: 'warm', label: '따뜻한 톤', en: 'warm color palette' },
      { id: 'cool', label: '차가운 톤', en: 'cool color palette' },
      { id: 'pastel', label: '파스텔', en: 'pastel colors' },
      { id: 'contrast', label: '고대비', en: 'high contrast' },
      { id: 'bw', label: '흑백', en: 'black and white' },
      { id: 'vintage', label: '빈티지 톤', en: 'faded vintage tones' },
    ],
  },
];

export const DEPTHS = [
  { id: 'auto', label: '자동', en: '' },
  { id: 'sharp', label: '배경 선명하게', en: 'deep focus, sharp background' },
  { id: 'blur', label: '배경 흐리게', en: 'shallow depth of field, blurred background' },
];

export const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'];

export const NEGATIVE_QUICK = [
  { id: 'blur', label: '흐림', en: 'blurry' },
  { id: 'hands', label: '왜곡된 손', en: 'distorted hands, extra fingers' },
  { id: 'watermark', label: '워터마크', en: 'watermark' },
  { id: 'text', label: '글자', en: 'text, letters, captions' },
  { id: 'lowq', label: '저화질', en: 'low quality, jpeg artifacts' },
];

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CAT_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
// 영어 프롬프트에 넣는 순서
const ORDER_AFTER_SUBJECT = ['subject', 'shot', 'placement', 'distance', 'camera', 'lens', 'light', 'mood'];

/** 알려진 분류·항목만 남기고, 단일 선택 분류는 하나만 남긴다. */
export function sanitizePicks(picks) {
  const out = {};
  if (!picks || typeof picks !== 'object') return out;
  for (const cat of CATEGORIES) {
    const raw = Array.isArray(picks[cat.id]) ? picks[cat.id] : [];
    const valid = [];
    for (const v of raw) {
      if (typeof v === 'string' && ID_RE.test(v) && cat.options.some((o) => o.id === v) && !valid.includes(v)) valid.push(v);
    }
    const kept = cat.multi ? valid.slice(0, 16) : valid.slice(0, 1);
    if (kept.length) out[cat.id] = kept;
  }
  return out;
}

function optionsOf(picks, catId) {
  const cat = CAT_BY_ID.get(catId);
  if (!cat) return [];
  const ids = Array.isArray(picks && picks[catId]) ? picks[catId] : [];
  return cat.options.filter((o) => ids.includes(o.id));
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function characterFragment(ch) {
  const name = clean(ch && ch.name) || '이름 없음';
  const look = clean(ch && ch.look);
  return look ? `Character "${name}": ${look}` : `Character "${name}"`;
}

/** 고른 분류 중 일부(예: style, shot, light, mood)만 영어 조각으로 돌려준다. */
export function fragmentsFor(picks, catIds) {
  const out = [];
  for (const id of catIds) for (const o of optionsOf(picks, id)) out.push(o.en);
  return out;
}

/**
 * @param {{picks?:object, subject?:string, depth?:string, ratio?:string|null, characters?:any[], extra?:string, negative?:string}} input
 * @returns {{positive:string, negative:string, summary:string}}
 */
export function buildPrompt({ picks = {}, subject = '', depth = 'auto', ratio = null, characters = [], extra = '', negative = '' } = {}) {
  const p = sanitizePicks(picks);
  const parts = [];
  parts.push(...fragmentsFor(p, ['style']));
  const subj = clean(subject);
  if (subj) parts.push(subj);
  for (const ch of characters || []) parts.push(characterFragment(ch));
  parts.push(...fragmentsFor(p, ORDER_AFTER_SUBJECT));
  const d = DEPTHS.find((x) => x.id === depth);
  if (d && d.en) parts.push(d.en);
  const ex = clean(extra);
  if (ex) parts.push(ex);
  if (ratio && RATIOS.includes(ratio)) parts.push(`aspect ratio ${ratio}`);

  const summaryBits = [];
  for (const cat of CATEGORIES) {
    const opts = optionsOf(p, cat.id);
    if (opts.length) summaryBits.push(`${cat.label}: ${opts.map((o) => o.label).join(', ')}`);
  }
  if (characters && characters.length) summaryBits.push(`등장인물: ${characters.map((c) => clean(c.name) || '이름 없음').join(', ')}`);
  if (d) summaryBits.push(`배경 심도: ${d.label}`);
  if (ratio && RATIOS.includes(ratio)) summaryBits.push(`비율: ${ratio}`);
  if (subj) summaryBits.push(`장면 묘사: ${subj.length > 40 ? subj.slice(0, 40) + '…' : subj}`);

  return {
    positive: parts.filter(Boolean).join(', '),
    negative: clean(negative),
    summary: summaryBits.length ? summaryBits.join(' · ') : '아직 고른 항목이 없습니다.',
  };
}

/** 클립보드 복사. 권한이 없으면 숨긴 textarea 로 다시 시도한다. */
export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 아래 방식으로 재시도 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * 분류별 칩 묶음. picks 객체를 직접 수정하고 onChange 를 부른다.
 * @returns {HTMLElement}
 */
export function buildChipPanel(picks, onChange, { idPrefix = 'pk' } = {}) {
  const wrap = h('div', { class: 'pk-cats' });
  for (const cat of CATEGORIES) {
    const labelId = `${idPrefix}-${cat.id}-label`;
    const group = h('div', { class: 'pk-chips', role: 'group', 'aria-label': `${cat.label} (${cat.multi ? '여러 개 선택' : '하나 선택'})` });
    const buttons = [];
    const sync = () => {
      const sel = Array.isArray(picks[cat.id]) ? picks[cat.id] : [];
      buttons.forEach(([b, o]) => b.setAttribute('aria-pressed', String(sel.includes(o.id))));
    };
    for (const o of cat.options) {
      const b = h('button', { type: 'button', class: 'pk-chip', 'aria-pressed': 'false', title: o.en }, o.label);
      b.addEventListener('click', () => {
        const sel = Array.isArray(picks[cat.id]) ? picks[cat.id].slice() : [];
        const at = sel.indexOf(o.id);
        let next;
        if (at >= 0) next = sel.filter((x) => x !== o.id);
        else next = cat.multi ? sel.concat(o.id).slice(0, 16) : [o.id];
        if (next.length) picks[cat.id] = next;
        else delete picks[cat.id];
        sync();
        onChange();
      });
      buttons.push([b, o]);
      group.append(b);
    }
    sync();
    wrap.append(h('div', { class: 'pk-cat' },
      h('p', { class: 'pk-cat-label', id: labelId, 'aria-hidden': 'true' }, cat.label, h('small', null, cat.multi ? ' 여러 개 선택' : ' 하나 선택')),
      group,
    ));
  }
  return wrap;
}

export function depthRadios(current, onPick, name) {
  const g = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '배경 심도' });
  for (const d of DEPTHS) {
    const id = `${name}-${d.id}`;
    const input = h('input', { type: 'radio', name, id, class: 'seg-input', checked: current === d.id });
    input.addEventListener('change', () => onPick(d.id));
    g.append(input, h('label', { htmlFor: id, class: 'seg-label' }, h('span', null, d.label)));
  }
  return g;
}

export function ratioSelect(current, onPick, id) {
  const sel = h('select', { id, class: 'input' });
  for (const r of RATIOS) sel.append(h('option', { value: r, selected: r === current }, `${r} 비율`));
  sel.addEventListener('change', () => onPick(sel.value));
  return sel;
}

/**
 * 프롬프트 도우미 대화상자. AI 를 호출하지 않고 고른 항목을 이어 붙인다.
 * @returns {Promise<{prompt:string,picks:object,subject:string,depth:string,ratio:string,characterIds:string[]}|null>}
 */
export function openPromptHelper({ initial = {}, characters = [], notify } = {}) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const picks = sanitizePicks(initial.picks || {});
    let subject = String(initial.subject || '');
    let depth = DEPTHS.some((d) => d.id === initial.depth) ? initial.depth : 'auto';
    let ratio = RATIOS.includes(initial.ratio) ? initial.ratio : '16:9';
    const charIds = new Set((initial.characterIds || []).filter((id) => characters.some((c) => c.id === id)));
    const key = uid('ph');
    const titleId = `${key}-title`;

    const preview = h('p', { class: 'pk-preview', 'aria-live': 'polite' });
    const summary = h('p', { class: 'pk-summary muted' });
    const update = () => {
      const r = buildPrompt({ picks, subject, depth, ratio, characters: characters.filter((c) => charIds.has(c.id)) });
      preview.textContent = r.positive || '항목을 고르거나 장면 묘사를 적으면 여기에 프롬프트가 만들어집니다.';
      summary.textContent = r.summary;
      return r;
    };

    const subjectArea = h('textarea', { id: `${key}-subject`, class: 'input', rows: 3, maxLength: 4000, value: subject,
      placeholder: '예: 비 갠 오후, 골목길을 걷는 두 사람' });
    subjectArea.addEventListener('input', () => { subject = subjectArea.value; update(); });

    const charBox = h('div', { class: 'pk-charbox', role: 'group', 'aria-label': '등장인물' });
    if (!characters.length) charBox.append(h('p', { class: 'muted small-text' }, '등록한 등장인물이 없습니다. 대본·장면 탭의 등장인물 레퍼런스에서 추가할 수 있습니다.'));
    for (const c of characters) {
      const cb = h('input', { type: 'checkbox', checked: charIds.has(c.id) });
      cb.addEventListener('change', () => { if (cb.checked) charIds.add(c.id); else charIds.delete(c.id); update(); });
      charBox.append(h('label', { class: 'check' }, cb, h('span', null, c.name || '이름 없음')));
    }

    const insertBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, '장면에 넣기');
    const cancelBtn = h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => done(null) }, '취소');
    const form = h('form', { class: 'dialog-form pk-form', novalidate: true },
      h('div', { class: 'dialog-head' },
        h('h2', { id: titleId, class: 'dialog-title' }, '프롬프트 도우미'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => done(null) }, '×'),
      ),
      h('p', { class: 'dialog-msg small-text' }, '항목을 고르면 이미지 생성 서비스에 붙여 넣을 영어 프롬프트를 조립합니다. AI 를 호출하지 않으며, 자유 입력 문장은 번역하지 않고 그대로 넣습니다.'),
      h('div', { class: 'pk-scroll' },
        h('div', { class: 'field' }, h('label', { htmlFor: `${key}-subject` }, '장면 묘사'), subjectArea),
        h('div', { class: 'field' }, h('span', { class: 'label-like' }, '등장인물 (외모 설명을 함께 넣습니다)'), charBox),
        buildChipPanel(picks, update, { idPrefix: key }),
        h('div', { class: 'two-col' },
          h('div', { class: 'field' }, h('span', { class: 'label-like' }, '배경 심도'), depthRadios(depth, (v) => { depth = v; update(); }, `${key}-depth`)),
          h('div', { class: 'field' }, h('label', { htmlFor: `${key}-ratio` }, '비율'), ratioSelect(ratio, (v) => { ratio = v; update(); }, `${key}-ratio`)),
        ),
      ),
      h('div', { class: 'pk-result' }, h('p', { class: 'label-like' }, '조립된 프롬프트 미리보기'), preview, summary),
      h('div', { class: 'dialog-actions' }, insertBtn, cancelBtn),
    );
    const dlg = h('dialog', { class: 'dialog pk-dialog', 'aria-labelledby': titleId, 'aria-modal': 'true', role: 'dialog' }, form);
    let finished = false;
    function done(value) {
      if (finished) return;
      finished = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus();
      resolve(value);
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = update();
      if (!r.positive) {
        if (notify) notify('프롬프트가 비어 있습니다. 항목을 고르거나 장면 묘사를 적어 주세요.', 'error');
        return;
      }
      done({ prompt: r.positive, picks: sanitizePicks(picks), subject, depth, ratio, characterIds: [...charIds] });
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    update();
    document.body.append(dlg);
    dlg.showModal();
    subjectArea.focus();
  });
}
