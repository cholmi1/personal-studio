// Screenshot-led creative workspaces. AI actions always use the existing consent controller.
import { h, clear, uid, clamp, downloadBlob } from './dom.js';
import { icon } from './icons.js';
import { assetUrl } from './api.js';
import { openSketchPad as sketchPad } from './sketch.js';
import { makeScene, scenesToCsv } from './story.js';
import { splitIntoCount } from './story-split.js';

export const FEATURE_TOOLS = [
  { id: 'canvas', name: '디렉터 캔버스', desc: '스케치와 화풍으로 나만의 장면 완성', icon: 'pen' },
  { id: 'signature', name: '시그니처 이미지 생성', desc: '텍스트로 상상하는 이미지를 생성', icon: 'image' },
  { id: 'photo-anime', name: '실사 애니화', desc: '실사 사진을 애니메이션으로 변환', icon: 'layers' },
  { id: 'anime-photo', name: '애니 실사화', desc: '애니메이션 이미지를 실사로 변환', icon: 'image' },
  { id: 'compose', name: '멀티 이미지 에디터', desc: '다중 참조 이미지 조합 및 컨셉 편집', icon: 'scenes' },
  { id: 'storyboard', name: '스토리보드', desc: '등장인물과 대본으로 장면을 기획', icon: 'note' },
];
const STYLES = [
  ['photo', '실사', 'photorealistic, natural textures, cinematic photography'],
  ['anime', '2D 애니메이션', '2D Japanese animation, expressive line art, cel shading'],
  ['3d', '3D 애니메이션', 'high quality 3D animated film, detailed lighting'],
  ['caricature', '캐리커처', 'expressive caricature illustration'],
  ['indie', '인디 스타일', 'independent editorial illustration, textured hand drawn art'],
  ['watercolor', '수채화', 'watercolor painting, soft pigments and paper texture'],
  ['webtoon', '웹툰', 'Korean webtoon, refined line drawing, dramatic composition'],
  ['oil', '유화', 'oil painting, visible brush strokes, classical fine art'],
  ['sf', '빈티지 SF', 'retro science fiction illustration'],
  ['cyber', '사이버펑크', 'cyberpunk concept art, futuristic city and dramatic light'],
  ['luminous', '루미너스 애니', 'luminous animation art, delicate light and atmospheric colors'],
  ['night', '나이트 시티', 'cinematic night city, neon signs and reflections'],
  ['tarot', '타로 카드', 'ornate tarot card illustration, symbolic composition'],
  ['glass', '스테인드글라스', 'stained glass artwork, jewel colors and bold leading'],
  ['film', '빈티지 필름', 'vintage film photography, fine grain and muted colors'],
  ['paper', '페이퍼 컷아웃', 'layered paper cutout art, subtle dimensional shadows'],
  ['clay', '클레이 애니', 'clay animation, tactile handmade miniature'],
  ['street', '스트리트 아트', 'street art mural, bold painted forms'],
  ['noir', '느와르', 'black and white film noir, dramatic chiaroscuro'],
];
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const DIMENSIONS = { '1:1': '1024 × 1024', '16:9': '1536 × 1024', '9:16': '1024 × 1536', '4:3': '1536 × 1024', '3:4': '1024 × 1536' };
const sizeFor = ratio => ratio === '1:1' ? '1024x1024' : ['9:16', '3:4'].includes(ratio) ? '1024x1536' : '1536x1024';
const text = (v, max = 4000) => String(v || '').slice(0, max);
const unique = ids => [...new Set(ids.filter(Boolean))];
const styleText = key => (STYLES.find(s => s[0] === key) || STYLES[0])[2];
const depthText = { auto: '', sharp: 'deep depth of field, background in focus', blur: 'shallow depth of field, soft background bokeh' };

export function renderFeatureStudio(root, toolId, ctx) {
  const tool = FEATURE_TOOLS.find(t => t.id === toolId) || FEATURE_TOOLS[0];
  const projectState = ctx.getState();
  if (!projectState.featureStudio || typeof projectState.featureStudio !== 'object') projectState.featureStudio = {};
  const all = projectState.featureStudio;
  if (!all[tool.id] || typeof all[tool.id] !== 'object') all[tool.id] = {};
  const st = all[tool.id];
  st.prompt = text(st.prompt); st.style = STYLES.some(s => s[0] === st.style) ? st.style : 'photo';
  st.ratio = RATIOS.includes(st.ratio) ? st.ratio : tool.id === 'signature' ? '9:16' : '1:1';
  st.depth = ['auto', 'sharp', 'blur'].includes(st.depth) ? st.depth : 'auto';
  st.refIds = Array.isArray(st.refIds) ? st.refIds.slice(0, 8) : [];
  if (tool.id === 'compose') {
    st.mode = st.mode === 'reference' ? 'reference' : 'multi';
    st.regions = Array.isArray(st.regions) ? st.regions.slice(0, 8) : [];
    for (const r of st.regions) { r.x = clamp(Number(r.x) || 0, 0, 90); r.y = clamp(Number(r.y) || 0, 0, 90); r.w = clamp(Number(r.w) || 35, 10, 100 - r.x); r.h = clamp(Number(r.h) || 35, 10, 100 - r.y); }
  }
  let alive = true, busy = false, currentAction = '', error = '';
  const disposers = [];
  const assets = () => ctx.getAssets?.() || [];
  const asset = id => assets().find(a => a.id === id);
  const current = () => alive && ctx.getState() === projectState;
  const dirty = () => { if (current()) ctx.markDirty(); };
  const save = (key, value) => { st[key] = value; dirty(); };
  const rerender = () => { if (current()) draw(); };
  const fail = e => { error = e?.message || '요청을 처리하지 못했습니다. 입력 내용은 유지됩니다.'; ctx.notify(error, 'error'); };
  const btn = (label, fn, kind = '', iconName = '') => h('button', { type: 'button', class: `fs-btn ${kind}`, onclick: fn, disabled: busy }, iconName ? icon(iconName) : null, h('span', null, label));
  const panel = (...children) => h('section', { class: 'fs-panel' }, ...children);
  const title = (label, iconName = '') => h('h3', { class: 'fs-section-title' }, iconName ? icon(iconName) : null, label);
  const hint = value => h('p', { class: 'fs-hint' }, value);
  const field = (label, control, extra = null) => h('label', { class: 'fs-field' }, h('span', { class: 'fs-label' }, label), control, extra);
  const textarea = (key, label, placeholder, rows = 5, maxLength = 4000, obj = st) => {
    const input = h('textarea', { class: 'fs-input', rows, value: obj[key] || '', placeholder, maxLength, 'aria-label': label, oninput: e => { obj[key] = e.target.value; dirty(); } });
    return field(label, input);
  };
  async function copy(value) {
    if (!value.trim()) { ctx.notify('먼저 내용을 입력해 주세요.', 'info'); return; }
    try { await navigator.clipboard.writeText(value); ctx.notify('프롬프트를 복사했습니다.', 'success'); }
    catch { ctx.notify('복사를 허용하지 않았습니다. 입력 내용을 직접 선택해 복사해 주세요.', 'error'); }
  }
  async function action(label, fn) {
    if (busy) return;
    error = ''; busy = true; currentAction = label; draw();
    try { await fn(); } catch (e) { if (current()) fail(e); }
    finally { busy = false; currentAction = ''; rerender(); }
  }
  async function upload(files, fn) {
    if (!files?.length || busy) return;
    await action('이미지 업로드 중', async () => {
      const added = await ctx.uploadFiles(Array.from(files));
      if (!current()) return;
      if (added?.length) { fn(added); dirty(); }
    });
  }
  function fileInput(fn, multiple = false) {
    return h('input', { type: 'file', class: 'fs-file-input', accept: 'image/png,image/jpeg,image/webp', multiple, 'aria-label': multiple ? '참조 이미지 업로드' : '원본 이미지 업로드', onchange: e => { upload(e.target.files, fn); e.target.value = ''; } });
  }
  function uploadCard(key = 'inputAssetId', label = '클릭하여 이미지 업로드', compact = false) {
    const selected = asset(st[key]);
    const input = fileInput(added => save(key, added[0].id));
    const drop = h('label', { class: `fs-upload ${compact ? 'is-compact' : ''} ${selected ? 'has-image' : ''}`, ondragover: e => { e.preventDefault(); }, ondrop: e => { e.preventDefault(); upload(e.dataTransfer.files, added => save(key, added[0].id)); } },
      input, selected ? h('img', { src: assetUrl(selected), alt: selected.name }) : h('span', { class: 'fs-empty-mark' }, icon('upload')),
      h('span', { class: 'fs-upload-caption' }, h('strong', null, selected ? '이미지 바꾸기' : label), h('small', null, selected ? selected.name : 'PNG, JPG, WEBP · 최대 10MB')));
    return h('div', { class: 'fs-upload-wrap' }, drop, assetSelect(key, '자료함에서 원본 선택'), selected ? btn('원본 제거', () => { save(key, null); rerender(); }, 'fs-quiet', 'trash') : null);
  }
  function assetSelect(key, label, obj = st, callback = null) {
    const select = h('select', { class: 'fs-input fs-select', 'aria-label': label, onchange: e => { obj[key] = e.target.value || null; dirty(); if (callback) callback(); else rerender(); } },
      h('option', { value: '' }, label), ...assets().map(a => h('option', { value: a.id, selected: obj[key] === a.id }, a.name)));
    return select;
  }
  function stylePicker(compact = false) {
    return h('div', { class: 'fs-field' }, title('화풍(스타일) 선택', 'pen'), h('div', { class: `fs-styles ${compact ? 'is-compact' : ''}`, role: 'group', 'aria-label': '화풍 선택' },
      ...STYLES.slice(0, compact ? 5 : STYLES.length).map(([key, label], i) => h('button', { type: 'button', class: `fs-style ${st.style === key ? 'is-selected' : ''}`, 'aria-pressed': st.style === key, disabled: busy, onclick: () => { save('style', key); rerender(); } }, h('span', { class: 'fs-style-glyph' }, icon(['image', 'pen', 'layers', 'text', 'leaf'][i % 5])), compact ? ({ anime: '2D 애니', '3d': '3D 애니', indie: '인디' }[key] || label) : label))));
  }
  function ratios() {
    return h('div', { class: 'fs-field' }, title('종횡비 선택', 'scenes'), h('div', { class: 'fs-options', role: 'group', 'aria-label': '종횡비 선택' }, ...RATIOS.map(r => h('button', { type: 'button', class: `fs-option ${st.ratio === r ? 'is-selected' : ''}`, 'aria-pressed': st.ratio === r, disabled: busy, onclick: () => { save('ratio', r); rerender(); } }, h('strong', null, r)))), hint(`API 생성 크기: ${DIMENSIONS[st.ratio]}px. 요청 비율은 프롬프트에 반영하며, 파일은 가장 가까운 지원 크기로 생성됩니다.`));
  }
  function prompt() {
    return [st.prompt.trim(), `Style: ${styleText(st.style)}.`, `Requested aspect ratio: ${st.ratio}.`, depthText[st.depth] || ''].filter(Boolean).join('\n');
  }
  async function generateImage(customPrompt = prompt(), ids = []) {
    if (!customPrompt.trim() || !st.prompt.trim() && tool.id === 'signature') throw new Error('생성할 장면을 프롬프트에 입력해 주세요.');
    const refs = unique(ids).filter(id => asset(id));
    if (refs.length > 4) throw new Error('현재 이미지 API에는 서로 다른 참조 이미지를 최대 4장까지 전송할 수 있습니다. 영역은 8개까지 배치할 수 있지만, 서로 다른 이미지는 4장 이하로 줄여 주세요.');
    const result = await ctx.ai.image({ prompt: customPrompt, assetIds: refs, size: sizeFor(st.ratio) });
    if (result?.asset && current()) { save('resultAssetId', result.asset.id); ctx.notify('결과를 이 작업의 자료함에 저장했습니다.', 'success'); }
  }
  function resultPanel(emptyText = '설정을 선택하고 프롬프트를 입력해 주세요.') {
    const output = asset(st.resultAssetId);
    return h('div', { class: 'fs-result-shell' }, h('div', { class: 'fs-result-heading' }, h('span', null, output ? '생성 결과' : '결과 미리보기'), h('span', { class: 'fs-pill' }, output ? 'SAVED' : 'PREVIEW')),
      h('div', { class: `fs-result ${busy ? 'is-loading' : ''}`, 'aria-busy': busy },
        output ? h('img', { src: assetUrl(output), alt: 'AI 생성 결과 이미지' }) : h('div', { class: 'fs-result-empty' }, h('span', { class: 'fs-empty-mark' }, icon('image')), h('p', null, busy ? currentAction : emptyText)),
        busy ? h('div', { class: 'fs-loading' }, h('span'), h('strong', null, currentAction), h('small', null, '완료될 때까지 이 작업을 열어 두세요.')) : null),
      output ? h('div', { class: 'fs-result-actions' }, h('a', { class: 'fs-btn', href: `${assetUrl(output)}?download=1`, download: output.name }, icon('download'), 'PNG 다운로드'), btn('이미지 편집기 열기', () => ctx.switchTab('image'), 'fs-quiet', 'layers')) : null);
  }
  function generationFooter(label, fn) {
    return h('div', { class: 'fs-generate-block' }, btn(label, () => action(label, fn), 'fs-primary', 'pen'), hint('생성 전 이미지 외부 전송과 API 비용을 별도로 확인합니다.'));
  }
  function drawSignature(body) {
    const random = h('input', { type: 'checkbox', checked: !!st.randomSeed, disabled: busy, onchange: e => { save('randomSeed', e.target.checked); if (e.target.checked) save('seed', Math.floor(Math.random() * 2147483647)); rerender(); } });
    const seed = h('input', { class: 'fs-input', type: 'number', min: 0, max: 2147483647, value: st.seed ?? '', placeholder: '고정 시드 (선택)', 'aria-label': '고정 시드', oninput: e => { const n = Number(e.target.value); save('seed', e.target.value === '' ? null : clamp(Math.floor(n), 0, 2147483647)); } });
    const settings = h('div', { class: 'fs-settings' }, stylePicker(true), textarea('prompt', '프롬프트 (Prompt)', '상상하는 이미지의 피사체, 배경, 분위기와 카메라 구도를 자세히 적어 주세요.', 6),
      ratios(), h('div', { class: 'fs-field' }, title('카메라 심도 (배경 선명도)', 'image'), h('div', { class: 'fs-options fs-depth' }, ...[['auto', '자동'], ['sharp', '배경 선명하게'], ['blur', '배경 흐리게']].map(([key, label]) => h('button', { type: 'button', class: `fs-option ${st.depth === key ? 'is-selected' : ''}`, 'aria-pressed': st.depth === key, disabled: busy, onclick: () => { save('depth', key); rerender(); } }, label)))),
      h('div', { class: 'fs-field' }, h('label', { class: 'fs-check' }, random, '랜덤 시드 만들기'), seed, hint('시드는 외부 도구 복사용입니다. 현재 API는 고정 시드 재현을 지원하지 않습니다.')),
      generationFooter('이미지 생성하기', () => generateImage()), btn('프롬프트 복사', () => copy(prompt() + (st.seed == null ? '' : `\nSeed (external tool only): ${st.seed}`)), 'fs-quiet', 'note'));
    body.append(h('div', { class: 'fs-split' }, settings, resultPanel('왼쪽에서 화풍을 선택하고 프롬프트를 입력하세요.')));
  }
  function drawConversion(body) {
    const toAnime = tool.id === 'photo-anime';
    const convert = () => {
      if (!asset(st.inputAssetId)) throw new Error('변환할 원본 이미지를 먼저 업로드하거나 자료함에서 선택해 주세요.');
      return generateImage([toAnime ? 'Transform the provided real photograph into a high-quality 2D anime illustration.' : 'Transform the provided anime or illustrated image into a photorealistic photograph.',
        'Preserve the original subject identity, pose, clothing, composition and important details. Return an image, not an explanation.', st.prompt.trim(), `Requested aspect ratio: ${st.ratio}.`].filter(Boolean).join('\n'), [st.inputAssetId]);
    };
    body.append(h('div', { class: 'fs-conversion' },
      h('div', { class: 'fs-pair' }, h('section', null, title(toAnime ? '원본 이미지 (Photo)' : '원본 이미지 (Anime)'), uploadCard()), h('section', null, title(toAnime ? '변환 결과 (Anime)' : '변환 결과 (Photo)'), resultPanel('변환된 이미지가 이곳에 표시됩니다.'))),
      h('div', { class: 'fs-convert-options' }, textarea('prompt', '추가 요청 (선택)', '유지하거나 바꾸고 싶은 세부 내용을 적어 주세요.', 2), ratios()),
      generationFooter(toAnime ? '애니화 시작' : '실사화 시작', convert), btn('변환 요청문 복사', () => copy((toAnime ? '실사 사진을 2D 애니메이션으로 변환. ' : '애니메이션 이미지를 실사 사진으로 변환. ') + '인물, 포즈, 의상, 구도를 유지. ' + st.prompt), 'fs-quiet', 'note')));
  }
  function drawCanvas(body) {
    const sketch = async () => {
      const [w, hh] = st.ratio.split(':').map(Number);
      const sketchResult = await (ctx.openSketchPad || sketchPad)({ width: w > hh ? 1280 : w === hh ? 1024 : 720, height: w > hh ? 720 : w === hh ? 1024 : 1280, uploadBlob: ctx.uploadBlob, notify: ctx.notify, title: '디렉터 스케치 캔버스' });
      if (sketchResult && current()) { save('inputAssetId', sketchResult.id); rerender(); }
    };
    const input = asset(st.inputAssetId);
    const stage = input ? h('div', { class: 'fs-canvas-input' }, h('img', { src: assetUrl(input), alt: '디렉터 스케치 원본' }), h('div', { class: 'fs-toolbar' }, btn('스케치 다시 그리기', sketch, '', 'pen'), btn('원본 제거', () => { save('inputAssetId', null); rerender(); }, 'fs-quiet', 'trash'))) :
      h('div', { class: 'fs-sketch-empty' }, btn('스케치 창 열기', sketch, 'fs-sketch-launch', 'pen'), hint('넓은 캔버스에서 원하는 장면을 자유롭게 그려 보세요.'), h('span', { class: 'fs-or' }, '또는'), uploadCard('inputAssetId', '이미지 직접 업로드', true));
    body.append(h('div', { class: 'fs-director' }, h('aside', { class: 'fs-settings fs-director-settings' }, stylePicker(), ratios(), textarea('prompt', '장면 묘사 프롬프트', '스케치의 피사체, 상황, 배경을 설명해 주세요. 선택한 화풍은 자동으로 반영됩니다.', 5),
      generationFooter('스케치를 완성 이미지로', () => { if (!asset(st.inputAssetId)) throw new Error('스케치를 저장하거나 원본 이미지를 올려 주세요.'); return generateImage(`Complete the supplied sketch or composition as a polished artwork. Preserve the intended composition and subjects.\n${prompt()}`, [st.inputAssetId]); }), btn('프롬프트 복사', () => copy(prompt()), 'fs-quiet', 'note')),
      h('div', { class: 'fs-canvas-stage' }, stage, st.resultAssetId ? resultPanel() : null)));
  }
  function refsPicker(max = 4) {
    const items = h('div', { class: 'fs-ref-list' });
    for (const id of st.refIds) {
      const a = asset(id); if (!a) continue;
      items.append(h('div', { class: 'fs-ref-thumb' }, h('img', { src: assetUrl(a), alt: a.name }), btn('제거', () => { save('refIds', st.refIds.filter(x => x !== id)); rerender(); }, 'fs-ref-remove', 'close')));
    }
    const input = fileInput(added => { const next = unique([...st.refIds, ...added.map(a => a.id)]); if (next.length > max) ctx.notify(`참조는 ${max}장까지만 선택했습니다. 나머지 업로드 파일은 자료함에 보관됩니다.`, 'info'); save('refIds', next.slice(0, max)); }, true);
    items.append(h('label', { class: 'fs-ref-add' }, input, icon('upload'), h('span', null, '이미지 추가')));
    const select = h('select', { class: 'fs-input', 'aria-label': '자료함에서 참조 추가', onchange: e => {
      const id = e.target.value; if (!id) return;
      if (!st.refIds.includes(id) && st.refIds.length >= max) { ctx.notify(`참조 이미지는 최대 ${max}장입니다.`, 'error'); return; }
      save('refIds', unique([...st.refIds, id])); rerender();
    } }, h('option', { value: '' }, '자료함에서 참조 추가'), ...assets().filter(a => !st.refIds.includes(a.id)).map(a => h('option', { value: a.id }, a.name)));
    return h('div', { class: 'fs-refs' }, items, select, hint(`최대 ${max}장 · 선택한 이미지의 외모와 특징을 요청에 함께 반영합니다.`));
  }
  function regionsBoard() {
    const board = h('div', { class: 'fs-matrix', role: 'group', 'aria-label': '이미지 배치 캔버스. 영역을 드래그하여 이동하고 오른쪽 아래 손잡이로 크기를 조절합니다.', ondragover: e => e.preventDefault(), ondrop: e => {
      e.preventDefault(); if (st.regions.length >= 8) { ctx.notify('영역은 최대 8개입니다.', 'info'); return; }
      upload(e.dataTransfer.files, added => { for (const a of added) { if (st.regions.length < 8) st.regions.push({ id: uid('region'), x: 8 + st.regions.length * 4, y: 8 + st.regions.length * 4, w: 38, h: 38, assetId: a.id, prompt: '' }); } });
    } });
    const [rw, rh] = st.ratio.split(':').map(Number); board.style.aspectRatio = `${rw} / ${rh}`;
    if (!st.regions.length) board.append(h('div', { class: 'fs-matrix-empty' }, icon('layers'), h('strong', null, '이미지를 끌어 놓거나 영역을 추가하세요.'), h('small', null, '위치와 크기가 생성 요청의 구도에 반영됩니다.')));
    st.regions.forEach((region, index) => {
      const a = asset(region.assetId);
      const regionEl = h('div', { class: 'fs-region', tabIndex: 0, 'aria-label': `영역 ${index + 1}. 방향키로 이동, Shift 방향키로 크기 조절`, onkeydown: e => {
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!delta || busy) return;
        e.preventDefault(); if (e.shiftKey) { region.w = clamp(region.w + delta[0] * 2, 10, 100 - region.x); region.h = clamp(region.h + delta[1] * 2, 10, 100 - region.y); }
        else { region.x = clamp(region.x + delta[0] * 2, 0, 100 - region.w); region.y = clamp(region.y + delta[1] * 2, 0, 100 - region.h); } place(); dirty();
      } }, a ? h('img', { src: assetUrl(a), alt: a.name, draggable: false }) : h('span', { class: 'fs-region-empty' }, icon('image'), `영역 ${index + 1}`), h('span', { class: 'fs-region-label' }, String(index + 1).padStart(2, '0')));
      const resize = h('span', { class: 'fs-resize', 'aria-hidden': 'true' }); regionEl.append(resize);
      function place() { for (const [key, value] of [['left', region.x], ['top', region.y], ['width', region.w], ['height', region.h]]) regionEl.style[key] = `${value}%`; }
      place();
      regionEl.addEventListener('pointerdown', e => {
        if (busy || e.button !== 0) return;
        e.preventDefault(); const rect = board.getBoundingClientRect(); const start = { ...region, clientX: e.clientX, clientY: e.clientY }; const sizing = e.target === resize;
        regionEl.setPointerCapture(e.pointerId); regionEl.classList.add('is-moving');
        const move = event => { const dx = (event.clientX - start.clientX) / rect.width * 100, dy = (event.clientY - start.clientY) / rect.height * 100;
          if (sizing) { region.w = clamp(start.w + dx, 10, 100 - region.x); region.h = clamp(start.h + dy, 10, 100 - region.y); }
          else { region.x = clamp(start.x + dx, 0, 100 - region.w); region.y = clamp(start.y + dy, 0, 100 - region.h); }
          place(); };
        const end = () => { regionEl.removeEventListener('pointermove', move); regionEl.removeEventListener('pointerup', end); regionEl.removeEventListener('pointercancel', end); regionEl.classList.remove('is-moving'); dirty(); };
        regionEl.addEventListener('pointermove', move); regionEl.addEventListener('pointerup', end); regionEl.addEventListener('pointercancel', end);
      });
      board.append(regionEl);
    });
    return board;
  }
  function drawCompose(body) {
    const modes = h('div', { class: 'fs-mode-switch', role: 'group', 'aria-label': '에디터 모드' }, ...[['multi', '모드 1 · 멀티 캔버스'], ['reference', '모드 2 · 메인 + 참조']].map(([key, label]) => h('button', { type: 'button', class: `fs-btn ${st.mode === key ? 'is-selected' : ''}`, 'aria-pressed': st.mode === key, disabled: busy, onclick: () => { save('mode', key); rerender(); } }, label)));
    const left = h('div', { class: 'fs-compose-controls' }, panel(stylePicker(true), ratios()));
    if (st.mode === 'multi') {
      const add = () => { if (st.regions.length >= 8) { ctx.notify('영역은 최대 8개입니다. 기존 영역을 삭제한 뒤 추가해 주세요.', 'info'); return; } st.regions.push({ id: uid('region'), x: 10 + st.regions.length * 3, y: 10 + st.regions.length * 3, w: 36, h: 36, assetId: null, prompt: '' }); dirty(); rerender(); };
      left.append(panel(h('div', { class: 'fs-toolbar' }, h('div', null, title('도화지 구성 및 영역 관리', 'scenes'), hint('드래그 이동 · 모서리 크기 조절 · 키보드 방향키 지원')), btn(`영역 추가 (${st.regions.length}/8)`, add, '', 'plus'), btn('전체 초기화', async () => { if (await ctx.confirm({ title: '영역 초기화', message: '현재 배치 영역을 모두 지울까요? 원본 이미지는 자료함에 남습니다.', okLabel: '초기화' })) { st.regions = []; dirty(); rerender(); } }, 'fs-danger', 'trash')),
        h('div', { class: 'fs-matrix-heading' }, h('strong', null, 'CONCEPT MATRIX'), h('small', null, '이미지의 위치와 크기로 장면을 설계하세요.')), regionsBoard(),
        st.regions.length ? h('div', { class: 'fs-region-settings' }, ...st.regions.map((r, i) => h('div', { class: 'fs-region-row' }, h('strong', null, String(i + 1).padStart(2, '0')), assetSelect('assetId', '영역 이미지 선택', r), h('input', { class: 'fs-input', value: r.prompt || '', placeholder: '영역 설명 (선택)', maxLength: 600, 'aria-label': `영역 ${i + 1} 설명`, oninput: e => { r.prompt = e.target.value; dirty(); } }), btn('삭제', () => { st.regions.splice(i, 1); dirty(); rerender(); }, 'fs-quiet', 'trash')))) : null,
        hint('영역 8개까지 지원합니다. 현재 API에는 서로 다른 이미지를 최대 4장까지 보낼 수 있습니다.')));
    } else left.append(panel(title('메인 이미지', 'image'), uploadCard('inputAssetId', '메인 이미지 업로드', true)), panel(title('참조 이미지', 'layers'), refsPicker(3)));
    const compositionPrompt = () => {
      const refIds = st.mode === 'multi' ? unique(st.regions.map(r => r.assetId)) : unique([st.inputAssetId, ...st.refIds]);
      const layout = st.mode === 'multi' ? st.regions.map((r, i) => `Region ${i + 1}: ${r.assetId ? `reference image ${refIds.indexOf(r.assetId) + 1}` : 'new visual element'}, left ${Math.round(r.x)}%, top ${Math.round(r.y)}%, width ${Math.round(r.w)}%, height ${Math.round(r.h)}%. ${r.prompt || ''}`).join('\n') : 'Use reference image 1 as the main image. Use remaining references for the requested edits; preserve main subject identity.';
      return { refs: refIds, value: `Combine the references into one coherent final composition, not an unedited collage. Follow these layout instructions:\n${layout}\n${prompt()}` };
    };
    const right = panel(title('최종 컨셉 디스플레이'), hint('조합한 이미지가 출력되는 공간입니다.'), resultPanel('구도와 프롬프트를 설정하고 조합 생성을 시작하세요.'), stylePicker(true), textarea('prompt', '포지티브 프롬프트', '생성할 이미지의 구체적인 상황, 배경, 분위기를 적어 주세요.', 4),
      btn('한글을 영어로 번역', () => action('프롬프트 번역 중', async () => { if (!st.prompt.trim()) throw new Error('번역할 프롬프트를 입력해 주세요.'); const r = await ctx.ai.gemini({ prompt: `Translate the following image prompt into English. Return only the translated prompt, no commentary:\n${st.prompt}`, assetIds: [], json: false }); if (r?.text && current()) save('prompt', text(r.text)); }), 'fs-quiet', 'text'),
      generationFooter('에디터 조합 생성 시작', () => { const data = compositionPrompt(); if (!st.prompt.trim() && !data.refs.length) throw new Error('이미지 또는 생성할 장면 설명을 입력해 주세요.'); return generateImage(data.value, data.refs); }), btn('조합 요청문 복사', () => copy(compositionPrompt().value), 'fs-quiet', 'note'));
    body.append(modes, h('div', { class: 'fs-compose-grid' }, left, h('div', { class: 'fs-compose-result' }, right)));
  }
  function drawStoryboard(body) {
    if (!projectState.story) projectState.story = { script: '', scenes: [], characters: [] };
    const story = projectState.story;
    if (!Array.isArray(story.scenes)) story.scenes = [];
    st.count = clamp(Math.floor(Number(st.count) || 10), 1, 60);
    async function approveOverwrite() { return !story.scenes.length || await ctx.confirm({ title: '스토리보드 다시 구성', message: '기존 장면을 새 장면으로 교체할까요? 자료함의 이미지는 삭제되지 않습니다.', okLabel: '장면 교체' }); }
    const split = async () => {
      if (!story.script.trim()) throw new Error('스토리 대본을 먼저 입력해 주세요.');
      if (!await approveOverwrite()) return;
      const parts = splitIntoCount(story.script, st.count);
      if (parts.some(part => part.length > 4000)) throw new Error('한 장면이 4,000자를 넘습니다. 대본에 문장 구분을 넣거나 장면 개수를 늘려 주세요. 기존 장면은 유지했습니다.');
      story.scenes = parts.map((part, i) => makeScene(part, i)); dirty();
      ctx.notify(`대본을 ${story.scenes.length}개 장면으로 나눴습니다. 문장 수보다 많이 나누지는 않습니다.`, 'success');
    };
    const aiPlan = async () => {
      if (!story.script.trim()) throw new Error('스토리 대본을 먼저 입력해 주세요.');
      if (!await approveOverwrite()) return;
      const r = await ctx.ai.gemini({ json: true, assetIds: st.refIds.filter(id => asset(id)), prompt: `Plan a cinematic storyboard from this script. Create ${st.count} scenes maximum (never more than 60). Keep narration in Korean. Keep character appearances consistent with reference images. Return only JSON with shape {"scenes":[{"title":"short title","narration":"script excerpt","imagePrompt":"detailed English image prompt","duration":4}]}. No markdown. Each narration <=4000 chars and imagePrompt <=4000 chars.\nScript:\n${story.script}` });
      if (!r?.text || !current()) return;
      let data; try { data = JSON.parse(r.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw new Error('AI 응답이 올바른 JSON이 아닙니다. 기존 장면은 유지했습니다.'); }
      if (!Array.isArray(data.scenes) || !data.scenes.length || data.scenes.length > 60) throw new Error('AI 장면 목록을 확인하지 못했습니다. 기존 장면은 유지했습니다.');
      story.scenes = data.scenes.map((s, i) => ({ ...makeScene(text(s.narration), i), title: text(s.title, 120) || `장면 ${i + 1}`, imagePrompt: text(s.imagePrompt), duration: clamp(Number(s.duration) || 4, 1, 600) })); dirty();
      ctx.notify('AI 스토리보드를 구성했습니다. 장면별 프롬프트를 검토해 주세요.', 'success');
    };
    const referencePanel = panel(title('등장인물 레퍼런스 이미지', 'image'), hint('장면에 적용할 인물의 명확한 사진을 추가하세요. AI 장면 기획 시 외모 참조로 전송합니다.'), refsPicker(4),
      btn('등장인물 이름·외모 관리', () => ctx.switchTab('story'), 'fs-quiet', 'text'));
    const count = h('input', { class: 'fs-input fs-count', type: 'number', min: 1, max: 60, value: st.count, 'aria-label': '분할할 장면 개수', onchange: e => { save('count', clamp(Math.floor(Number(e.target.value) || 10), 1, 60)); e.target.value = st.count; } });
    const scriptPanel = panel(title('스토리 대본 입력', 'note'), hint('영상이나 만화로 제작하고 싶은 이야기를 자유롭게 적어 주세요.'), textarea('script', '스토리 대본', '여기에 대본을 상세하게 입력해 주세요.', 7, 40000, story), h('div', { class: 'fs-toolbar fs-count-row' }, title('분할할 씬(Scene) 개수', 'layers'), h('label', { class: 'fs-count-label' }, count, '씬')),
      h('div', { class: 'fs-action-row' }, btn('대본 장면 나누기', () => action('대본 분할 중', split), '', 'scissors'), btn('AI 스토리보드 기획', () => action('AI 장면 기획 중', aiPlan), 'fs-primary', 'scenes')),
      hint('직접 나누기는 무료 로컬 기능입니다. AI 기획은 Gemini에 대본과 선택 사진을 전송하며 비용을 확인합니다.'));
    const scenesPanel = panel(h('div', { class: 'fs-toolbar' }, title(`스토리보드 · ${story.scenes.length}개 장면`, 'scenes'), btn('CSV 내려받기', () => { if (!story.scenes.length) { ctx.notify('먼저 대본을 장면으로 나눠 주세요.', 'info'); return; } downloadBlob(new Blob([scenesToCsv(story.scenes, story.characters || [])], { type: 'text/csv;charset=utf-8' }), '스토리보드.csv'); }, '', 'download'), btn('대본·장면 편집기', () => ctx.switchTab('story'), 'fs-quiet', 'pen')));
    if (!story.scenes.length) scenesPanel.append(h('div', { class: 'fs-board-empty' }, icon('scenes'), h('p', null, '대본을 입력하면 장면별 스토리보드를 만들 수 있습니다.')));
    else scenesPanel.append(h('div', { class: 'fs-scene-grid' }, ...story.scenes.map((scene, i) => {
      const a = asset(scene.assetId); const imgPrompt = scene.imagePrompt || scene.prompt || scene.narration;
      return h('article', { class: 'fs-scene-card' }, h('div', { class: 'fs-scene-image' }, a ? h('img', { src: assetUrl(a), alt: scene.title }) : icon('image'), h('span', null, String(i + 1).padStart(2, '0'))),
        h('div', { class: 'fs-scene-copy' }, h('h4', null, scene.title), h('p', null, scene.narration), textarea('imagePrompt', `장면 ${i + 1} 이미지 프롬프트`, '이미지 생성에 사용할 상세 묘사를 입력해 주세요.', 3, 4000, scene),
          h('div', { class: 'fs-action-row' }, btn('장면 이미지 생성', () => action(`장면 ${i + 1} 생성 중`, async () => {
            const value = (scene.imagePrompt || scene.prompt || scene.narration || '').trim(); if (!value) throw new Error('장면 이미지 프롬프트를 입력해 주세요.');
            const r = await ctx.ai.image({ prompt: `Create a cinematic storyboard frame. Maintain character identity from references.\n${value}`, assetIds: st.refIds.filter(id => asset(id)).slice(0, 4), size: '1536x1024' });
            if (r?.asset && current()) { scene.assetId = r.asset.id; dirty(); }
          }), 'fs-primary', 'image'), btn('복사', () => copy(imgPrompt), 'fs-quiet', 'note'))));
    })));
    body.append(h('div', { class: 'fs-storyboard' }, referencePanel, scriptPanel, scenesPanel));
  }
  function draw() {
    for (const dispose of disposers.splice(0)) dispose();
    clear(root);
    const body = h('div', { class: `fs-body fs-body-${tool.id}` });
    const shell = h('section', { class: `feature-studio fs-tool-${tool.id}`, 'aria-label': tool.name },
      h('header', { class: 'fs-header' }, h('span', { class: 'fs-tool-icon' }, icon(tool.icon)), h('div', null, h('div', { class: 'fs-title-row' }, h('h2', null, tool.name), h('span', { class: 'fs-version' }, tool.id === 'compose' ? 'EDITOR 3.0' : 'STUDIO')), h('p', null, tool.desc)), h('span', { class: 'fs-local-badge' }, '개인 작업실')),
      error ? h('div', { class: 'fs-error', role: 'alert' }, icon('alert'), error) : null, body);
    root.append(shell);
    if (tool.id === 'signature') drawSignature(body);
    else if (tool.id === 'canvas') drawCanvas(body);
    else if (tool.id === 'compose') drawCompose(body);
    else if (tool.id === 'storyboard') drawStoryboard(body);
    else drawConversion(body);
  }
  draw();
  return () => { alive = false; for (const dispose of disposers.splice(0)) dispose(); };
}
