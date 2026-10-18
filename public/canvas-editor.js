// 이미지 · 썸네일 캔버스 편집기. 모든 그리기는 브라우저 Canvas 에서만 이루어진다.
import { h, append, clear, uid, clamp, isHexColor, downloadBlob, safeFileName } from './dom.js';
import { icon } from './icons.js';
import { assetUrl } from './api.js';

export const RATIOS = [
  { w: 1280, h: 720, label: '가로', sub: '1280×720' },
  { w: 1080, h: 1920, label: '세로', sub: '1080×1920' },
  { w: 1080, h: 1080, label: '정사각', sub: '1080×1080' },
];
export const MAX_LAYERS = 20;
const MAX_LAYER_TEXT = 500;

const FONT_STACKS = {
  'sans-serif': '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", sans-serif',
  serif: '"Noto Serif KR", "Nanum Myeongjo", "AppleMyungjo", "Batang", "Noto Serif CJK KR", serif',
  monospace: '"D2Coding", "Consolas", "Menlo", monospace',
};
const FONT_OPTIONS = [
  { value: 'sans-serif', label: '고딕' },
  { value: 'serif', label: '명조' },
  { value: 'monospace', label: '고정폭' },
];
const BG_SWATCHES = ['#e8e3d8', '#f8f4ec', '#ffffff', '#24221e', '#47614b', '#a9b8a0', '#c9b48a', '#b65c42', '#3d5a73'];
const TEXT_SWATCHES = ['#24221e', '#ffffff', '#f5f0e6', '#47614b', '#b65c42', '#e2b04a'];

function fontStack(family) {
  if (FONT_STACKS[family]) return FONT_STACKS[family];
  const cleaned = String(family || '').replace(/[^\w\s,"'\-가-힣]/g, '').slice(0, 120);
  return cleaned ? `${cleaned}, sans-serif` : FONT_STACKS['sans-serif'];
}

export function makeLayer(editor, text = '문구를 입력하세요') {
  const w = editor.width || 1280;
  const hgt = editor.height || 720;
  return {
    id: uid('layer'),
    text: String(text).slice(0, MAX_LAYER_TEXT),
    x: Math.round(w / 2),
    y: Math.round(hgt * 0.38),
    fontSize: Math.round(Math.min(w, hgt) * 0.08),
    color: isDark(editor.background) ? '#ffffff' : '#24221e',
    fontFamily: 'sans-serif',
    align: 'center',
    shadow: false,
  };
}

function isDark(hex) {
  if (!isHexColor(hex)) return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

// ---------- 이미지 캐시 ----------
const imageCache = new Map(); // id -> { img, status }

function getImage(id, onReady) {
  if (!id) return null;
  let entry = imageCache.get(id);
  if (!entry) {
    const img = new Image();
    entry = { img, status: 'loading', waiters: [] };
    imageCache.set(id, entry);
    img.onload = () => { entry.status = 'ok'; entry.waiters.splice(0).forEach((f) => f()); };
    img.onerror = () => { entry.status = 'error'; entry.waiters.splice(0).forEach((f) => f()); };
    img.decoding = 'async';
    img.src = assetUrl({ id });
  }
  if (entry.status === 'loading' && onReady) entry.waiters.push(onReady);
  return entry;
}

export function forgetImage(id) {
  imageCache.delete(id);
}

function waitImage(id, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const entry = getImage(id);
    if (!entry || entry.status !== 'loading') return resolve(entry);
    const t = setTimeout(() => resolve(entry), timeoutMs);
    entry.waiters.push(() => { clearTimeout(t); resolve(entry); });
  });
}

// ---------- 그리기 ----------
function layerLines(layer) {
  return String(layer.text ?? '').split('\n');
}

function setFont(c, layer) {
  c.font = `700 ${clamp(Number(layer.fontSize) || 48, 6, 600)}px ${fontStack(layer.fontFamily)}`;
}

export function measureLayer(c, layer) {
  setFont(c, layer);
  const size = clamp(Number(layer.fontSize) || 48, 6, 600);
  const lines = layerLines(layer);
  const lineH = size * 1.25;
  let w = 0;
  for (const line of lines) w = Math.max(w, c.measureText(line || ' ').width);
  const hgt = Math.max(lineH, lines.length * lineH);
  const x = Number(layer.x) || 0;
  const align = ['left', 'center', 'right'].includes(layer.align) ? layer.align : 'left';
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  return { x: x0, y: Number(layer.y) || 0, w, h: hgt, lineH };
}

function drawImageFit(c, img, W, H, fit) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  const scale = fit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
  const dw = iw * scale, dh = ih * scale;
  c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/** @returns {{missingImage: boolean}} */
export function drawScene(c, editor, { selectedId = null, onImageReady = null } = {}) {
  const W = editor.width, H = editor.height;
  c.save();
  c.clearRect(0, 0, W, H);
  c.fillStyle = isHexColor(editor.background) ? editor.background : '#e8e3d8';
  c.fillRect(0, 0, W, H);
  let missingImage = false;
  if (editor.baseAssetId) {
    const entry = getImage(editor.baseAssetId, onImageReady);
    if (entry && entry.status === 'ok') drawImageFit(c, entry.img, W, H, editor.fit);
    else if (entry && entry.status === 'error') missingImage = true;
  }
  for (const layer of editor.textLayers) {
    const m = measureLayer(c, layer);
    const align = ['left', 'center', 'right'].includes(layer.align) ? layer.align : 'left';
    c.textAlign = align;
    c.textBaseline = 'top';
    c.fillStyle = isHexColor(layer.color) ? layer.color : '#24221e';
    if (layer.shadow) {
      const s = Number(layer.fontSize) || 48;
      c.shadowColor = 'rgba(0, 0, 0, 0.5)';
      c.shadowBlur = Math.max(2, s * 0.14);
      c.shadowOffsetX = Math.max(1, s * 0.04);
      c.shadowOffsetY = Math.max(1, s * 0.05);
    } else {
      c.shadowColor = 'transparent';
      c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
    }
    layerLines(layer).forEach((line, i) => {
      c.fillText(line, Number(layer.x) || 0, m.y + i * m.lineH + m.lineH * 0.1);
    });
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
    if (layer.id === selectedId) {
      const lw = Math.max(2, W / 480);
      const pad = Math.max(6, W / 160);
      c.lineWidth = lw;
      c.setLineDash([lw * 4, lw * 3]);
      c.strokeStyle = '#ffffff';
      c.strokeRect(m.x - pad, m.y - pad, m.w + pad * 2, m.h + pad * 2);
      c.lineDashOffset = lw * 3.5;
      c.strokeStyle = '#47614b';
      c.strokeRect(m.x - pad, m.y - pad, m.w + pad * 2, m.h + pad * 2);
      c.setLineDash([]);
      c.lineDashOffset = 0;
    }
  }
  c.restore();
  return { missingImage };
}

// ---------- 편집기 UI ----------
let selectedId = null;

/**
 * @param {HTMLElement} root
 * @param {{ getState: () => any, markDirty: () => void, notify: Function, getAssets: () => any[],
 *           uploadFiles: (files: File[]) => Promise<any[]>, projectTitle: () => string, aiBlocked: Function }} ctx
 */
export function renderEditor(root, ctx) {
  clear(root);
  const editor = ctx.getState().editor;
  if (!editor.textLayers.some((l) => l.id === selectedId)) selectedId = null;

  const canvas = h('canvas', {
    class: 'stage-canvas',
    width: editor.width,
    height: editor.height,
    tabIndex: 0,
    'aria-roledescription': '편집 캔버스',
    'aria-label': '썸네일 캔버스. 문구를 선택한 뒤 방향키로 이동, Shift와 함께 누르면 10픽셀씩 이동, Esc로 선택 해제.',
  });
  const c = canvas.getContext('2d');
  const sizeLabel = h('span', { class: 'counter' });
  const imageWarn = h('p', { class: 'warn-line', hidden: true, role: 'status' });
  const downloadBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: downloadPng }, icon('download'), h('span', null, 'PNG 내려받기'));

  const stagePanel = h('section', { class: 'panel stage-panel', 'aria-labelledby': 'stage-heading' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'stage-heading', class: 'panel-title' }, icon('image'), '캔버스'),
      sizeLabel,
    ),
    h('div', { class: 'stage' }, canvas),
    imageWarn,
    h('p', { class: 'hint' }, icon('info', 'icon-sm'), '문구를 끌어서 옮기세요. 캔버스를 선택(Tab)한 뒤 방향키로 1px, Shift+방향키로 10px씩 움직입니다.'),
    h('div', { class: 'stage-actions' },
      downloadBtn,
      h('button', { type: 'button', class: 'btn btn-ai', 'aria-disabled': 'true', onclick: () => ctx.aiBlocked('AI 이미지 생성') },
        icon('plug'), h('span', null, 'AI 이미지 생성'), h('span', { class: 'badge badge-off' }, 'AI 미연결')),
    ),
  );

  const side = h('div', { class: 'editor-side' });
  root.append(h('div', { class: 'editor-grid' }, stagePanel, side));

  // ----- 캔버스 설정 패널 -----
  const ratioGroup = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '캔버스 비율' });
  RATIOS.forEach((r, i) => {
    const id = `ratio-${i}`;
    const input = h('input', { type: 'radio', name: 'ratio', id, class: 'seg-input', checked: editor.width === r.w && editor.height === r.h });
    input.addEventListener('change', () => changeRatio(r));
    ratioGroup.append(input, h('label', { htmlFor: id, class: 'seg-label' },
      h('span', { class: `ratio-glyph r${i}`, 'aria-hidden': 'true' }), h('span', null, r.label), h('small', null, r.sub)));
  });

  const bgInput = h('input', { type: 'color', id: 'bg-color', class: 'color-input', value: isHexColor(editor.background) ? editor.background : '#e8e3d8' });
  bgInput.addEventListener('input', () => setBackground(bgInput.value));
  const bgSwatches = swatchRow(BG_SWATCHES, '배경색', (hex) => { bgInput.value = hex; setBackground(hex); });

  side.append(h('section', { class: 'panel', 'aria-labelledby': 'canvas-set-heading' },
    h('h3', { id: 'canvas-set-heading', class: 'panel-subtitle' }, '크기와 배경'),
    ratioGroup,
    h('div', { class: 'field color-field' },
      h('label', { htmlFor: 'bg-color' }, '배경색'),
      h('div', { class: 'color-row' }, bgInput, bgSwatches),
    ),
  ));

  // ----- 배경 이미지 패널 -----
  const imagePanel = h('section', { class: 'panel', 'aria-labelledby': 'image-set-heading' });
  side.append(imagePanel);

  // ----- 레이어 패널 -----
  const layerList = h('ul', { class: 'layer-list', 'aria-label': '텍스트 레이어 (위에 있는 것이 앞쪽)' });
  const addLayerBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: addLayer }, icon('plus', 'icon-sm'), h('span', null, '문구 추가'));
  side.append(h('section', { class: 'panel', 'aria-labelledby': 'layers-heading' },
    h('div', { class: 'panel-head' },
      h('h3', { id: 'layers-heading', class: 'panel-subtitle' }, icon('layers', 'icon-sm'), '텍스트 레이어'),
      addLayerBtn,
    ),
    layerList,
  ));

  // ----- 선택 레이어 속성 -----
  const propsPanel = h('section', { class: 'panel props-panel', 'aria-labelledby': 'props-heading' });
  side.append(propsPanel);

  // ---------- 동작 ----------
  function redraw() {
    const { missingImage } = drawScene(c, editor, { selectedId, onImageReady: redraw });
    imageWarn.hidden = !missingImage;
    if (missingImage) imageWarn.textContent = '배경 이미지를 불러오지 못했습니다. 자료가 삭제되었거나 로그인 세션이 끝났을 수 있습니다.';
    sizeLabel.textContent = `${editor.width}×${editor.height}px · 문구 ${editor.textLayers.length}개`;
  }

  function changeRatio(r) {
    if (editor.width === r.w && editor.height === r.h) return;
    const sx = r.w / editor.width, sy = r.h / editor.height;
    const fs = Math.min(r.w, r.h) / Math.min(editor.width, editor.height);
    for (const l of editor.textLayers) {
      l.x = Math.round(l.x * sx);
      l.y = Math.round(l.y * sy);
      l.fontSize = clamp(Math.round((Number(l.fontSize) || 48) * fs), 8, 400);
    }
    editor.width = r.w;
    editor.height = r.h;
    canvas.width = r.w;
    canvas.height = r.h;
    ctx.markDirty();
    redraw();
    renderProps();
  }

  function setBackground(hex) {
    if (!isHexColor(hex)) return;
    editor.background = hex.toLowerCase();
    ctx.markDirty();
    redraw();
  }

  function renderImagePanel() {
    clear(imagePanel);
    const assets = ctx.getAssets();
    const select = h('select', { id: 'base-asset', class: 'input' }, h('option', { value: '' }, '이미지 없음'));
    let found = !editor.baseAssetId;
    for (const a of assets) {
      const opt = h('option', { value: a.id }, a.name || '이름 없는 이미지');
      if (a.id === editor.baseAssetId) { opt.selected = true; found = true; }
      select.append(opt);
    }
    if (!found) select.append(h('option', { value: editor.baseAssetId, selected: true }, '(찾을 수 없는 이미지)'));
    select.addEventListener('change', () => {
      editor.baseAssetId = select.value || null;
      ctx.markDirty();
      redraw();
      renderImagePanel();
      document.getElementById('base-asset')?.focus();
    });

    const fitGroup = h('div', { class: 'seg seg-2', role: 'radiogroup', 'aria-label': '이미지 맞춤' });
    [['cover', '채우기', '여백 없이 자름'], ['contain', '맞추기', '전체가 보이게']].forEach(([val, label, sub]) => {
      const id = `fit-${val}`;
      const input = h('input', { type: 'radio', name: 'fit', id, class: 'seg-input', checked: editor.fit === val, disabled: !editor.baseAssetId });
      input.addEventListener('change', () => { editor.fit = val; ctx.markDirty(); redraw(); });
      fitGroup.append(input, h('label', { htmlFor: id, class: 'seg-label' }, h('span', null, label), h('small', null, sub)));
    });

    const fileInput = h('input', { type: 'file', id: 'editor-upload', class: 'sr-only', accept: 'image/png,image/jpeg,image/webp' });
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      if (!files.length) return;
      const created = await ctx.uploadFiles(files);
      if (created && created[0]) {
        editor.baseAssetId = created[0].id;
        ctx.markDirty();
        redraw();
        renderImagePanel();
      }
    });

    append(imagePanel, [
      h('h3', { id: 'image-set-heading', class: 'panel-subtitle' }, '배경 이미지'),
      h('div', { class: 'field' }, h('label', { htmlFor: 'base-asset' }, '자료에서 고르기'), select),
      fitGroup,
      h('div', { class: 'btn-row' },
        fileInput,
        h('label', { htmlFor: 'editor-upload', class: 'btn btn-sm file-btn', tabIndex: 0, role: 'button',
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } },
        icon('upload', 'icon-sm'), h('span', null, '새 이미지 올리기')),
        editor.baseAssetId ? h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => {
          editor.baseAssetId = null; ctx.markDirty(); redraw(); renderImagePanel();
        } }, '이미지 빼기') : null,
      ),
      assets.length ? null : h('p', { class: 'hint' }, 'PNG·JPEG·WebP 이미지를 올리면 이 작업의 자료에도 보관됩니다.'),
    ]);
  }

  function layerLabel(layer) {
    const t = String(layer.text || '').replace(/\s+/g, ' ').trim();
    return t ? (t.length > 22 ? t.slice(0, 22) + '…' : t) : '(빈 문구)';
  }

  function renderLayerList() {
    clear(layerList);
    addLayerBtn.disabled = editor.textLayers.length >= MAX_LAYERS;
    if (!editor.textLayers.length) {
      layerList.append(h('li', { class: 'empty-note small' }, h('p', { class: 'muted' }, '문구가 없습니다. "문구 추가"로 제목을 올려 보세요.')));
      return;
    }
    const n = editor.textLayers.length;
    for (let vi = 0; vi < n; vi++) {
      const idx = n - 1 - vi; // 화면 목록은 앞쪽(나중에 그리는 것)부터
      const layer = editor.textLayers[idx];
      const selected = layer.id === selectedId;
      const row = h('li', { class: `layer-row${selected ? ' is-selected' : ''}`, dataset: { id: layer.id } },
        h('button', { type: 'button', class: 'layer-pick', 'aria-pressed': String(selected), onclick: () => select(layer.id, true) },
          icon('text', 'icon-sm'), h('span', { class: 'layer-name' }, layerLabel(layer))),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '앞으로 가져오기', disabled: idx === n - 1, onclick: () => reorder(idx, 1) }, icon('up')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '뒤로 보내기', disabled: idx === 0, onclick: () => reorder(idx, -1) }, icon('down')),
        h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': '문구 삭제', onclick: () => removeLayer(layer.id) }, icon('trash')),
      );
      layerList.append(row);
    }
  }

  function select(id, focusProps = false) {
    selectedId = id;
    renderLayerList();
    renderProps();
    redraw();
    if (focusProps) document.getElementById('layer-text')?.focus();
  }

  function reorder(idx, delta) {
    const to = idx + delta;
    if (to < 0 || to >= editor.textLayers.length) return;
    const [l] = editor.textLayers.splice(idx, 1);
    editor.textLayers.splice(to, 0, l);
    ctx.markDirty();
    renderLayerList();
    redraw();
    const row = layerList.querySelector(`[data-id="${CSS.escape(l.id)}"]`);
    row?.querySelector(delta > 0 ? '[aria-label="앞으로 가져오기"]' : '[aria-label="뒤로 보내기"]')?.focus();
  }

  function addLayer() {
    if (editor.textLayers.length >= MAX_LAYERS) {
      ctx.notify(`문구는 최대 ${MAX_LAYERS}개까지 추가할 수 있습니다.`, 'error');
      return;
    }
    const layer = makeLayer(editor);
    layer.y = Math.round(editor.height * (0.25 + (editor.textLayers.length % 4) * 0.12));
    editor.textLayers.push(layer);
    ctx.markDirty();
    select(layer.id, true);
    document.getElementById('layer-text')?.select();
  }

  function removeLayer(id) {
    const i = editor.textLayers.findIndex((l) => l.id === id);
    if (i < 0) return;
    editor.textLayers.splice(i, 1);
    if (selectedId === id) selectedId = null;
    ctx.markDirty();
    renderLayerList();
    renderProps();
    redraw();
    ctx.notify('문구를 삭제했습니다. 저장해야 서버에 반영됩니다.', 'info');
  }

  function current() {
    return editor.textLayers.find((l) => l.id === selectedId) || null;
  }

  let xInput = null, yInput = null;

  function renderProps() {
    clear(propsPanel);
    xInput = yInput = null;
    const layer = current();
    if (!layer) {
      propsPanel.append(
        h('h3', { id: 'props-heading', class: 'panel-subtitle' }, '선택한 문구'),
        h('p', { class: 'muted small-text' }, '캔버스나 목록에서 문구를 선택하면 글자 크기·색·정렬·그림자를 바꿀 수 있습니다.'),
      );
      return;
    }
    const changed = () => { ctx.markDirty(); redraw(); };

    const text = h('textarea', { id: 'layer-text', class: 'input', rows: 2, value: layer.text, maxLength: MAX_LAYER_TEXT });
    text.addEventListener('input', () => {
      layer.text = text.value;
      changed();
      const nameEl = layerList.querySelector(`[data-id="${CSS.escape(layer.id)}"] .layer-name`);
      if (nameEl) nameEl.textContent = layerLabel(layer);
    });

    const sizeNum = h('input', { id: 'layer-size', class: 'input num', type: 'number', min: 8, max: 400, step: 1, value: String(layer.fontSize), inputmode: 'numeric' });
    const sizeRange = h('input', { class: 'range', type: 'range', min: 8, max: 400, step: 1, value: String(layer.fontSize), 'aria-label': '글자 크기 조절' });
    const setSize = (v) => {
      const n = clamp(Math.round(Number(v) || 8), 8, 400);
      layer.fontSize = n;
      sizeNum.value = String(n);
      sizeRange.value = String(n);
      changed();
    };
    sizeNum.addEventListener('change', () => setSize(sizeNum.value));
    sizeRange.addEventListener('input', () => setSize(sizeRange.value));

    const color = h('input', { id: 'layer-color', class: 'color-input', type: 'color', value: isHexColor(layer.color) ? layer.color : '#24221e' });
    color.addEventListener('input', () => { layer.color = color.value.toLowerCase(); changed(); });
    const colorSw = swatchRow(TEXT_SWATCHES, '글자색', (hex) => { color.value = hex; layer.color = hex; changed(); });

    const font = h('select', { id: 'layer-font', class: 'input' });
    for (const f of FONT_OPTIONS) font.append(h('option', { value: f.value, selected: layer.fontFamily === f.value }, f.label));
    if (!FONT_STACKS[layer.fontFamily]) font.append(h('option', { value: layer.fontFamily, selected: true }, String(layer.fontFamily || '기본')));
    font.addEventListener('change', () => { layer.fontFamily = font.value; changed(); });

    const alignGroup = h('div', { class: 'seg seg-3 seg-icons', role: 'radiogroup', 'aria-label': '정렬' });
    [['left', 'alignLeft', '왼쪽'], ['center', 'alignCenter', '가운데'], ['right', 'alignRight', '오른쪽']].forEach(([val, ic, label]) => {
      const id = `align-${val}`;
      const input = h('input', { type: 'radio', name: 'align', id, class: 'seg-input', checked: layer.align === val });
      input.addEventListener('change', () => { layer.align = val; changed(); });
      alignGroup.append(input, h('label', { htmlFor: id, class: 'seg-label', title: `${label} 정렬` }, icon(ic, 'icon-sm'), h('span', null, label)));
    });

    const shadow = h('input', { id: 'layer-shadow', type: 'checkbox', checked: !!layer.shadow });
    shadow.addEventListener('change', () => { layer.shadow = shadow.checked; changed(); });

    xInput = h('input', { id: 'layer-x', class: 'input num', type: 'number', step: 1, value: String(Math.round(layer.x)), inputmode: 'numeric' });
    yInput = h('input', { id: 'layer-y', class: 'input num', type: 'number', step: 1, value: String(Math.round(layer.y)), inputmode: 'numeric' });
    xInput.addEventListener('change', () => { layer.x = clamp(Math.round(Number(xInput.value) || 0), -editor.width, editor.width * 2); changed(); });
    yInput.addEventListener('change', () => { layer.y = clamp(Math.round(Number(yInput.value) || 0), -editor.height, editor.height * 2); changed(); });

    propsPanel.append(
      h('div', { class: 'panel-head' },
        h('h3', { id: 'props-heading', class: 'panel-subtitle' }, '선택한 문구'),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet danger-text', onclick: () => removeLayer(layer.id) }, icon('trash', 'icon-sm'), h('span', null, '삭제')),
      ),
      h('div', { class: 'field' }, h('label', { htmlFor: 'layer-text' }, '내용 (줄바꿈 가능)'), text),
      h('div', { class: 'field' }, h('label', { htmlFor: 'layer-size' }, '글자 크기(px)'), h('div', { class: 'range-row' }, sizeRange, sizeNum)),
      h('div', { class: 'field color-field' }, h('label', { htmlFor: 'layer-color' }, '글자색'), h('div', { class: 'color-row' }, color, colorSw)),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { htmlFor: 'layer-font' }, '글꼴'), font),
        h('div', { class: 'field check-field' }, h('label', { class: 'check', htmlFor: 'layer-shadow' }, shadow, h('span', null, '그림자'))),
      ),
      h('div', { class: 'field' }, h('span', { class: 'label-like', id: 'align-label' }, '정렬'), alignGroup),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { htmlFor: 'layer-x' }, '가로 위치 X'), xInput),
        h('div', { class: 'field' }, h('label', { htmlFor: 'layer-y' }, '세로 위치 Y'), yInput),
      ),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => {
          layer.align = 'center'; layer.x = Math.round(editor.width / 2); changed(); renderProps();
        } }, icon('center', 'icon-sm'), h('span', null, '가로 가운데')),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => {
          const m = measureLayer(c, layer); layer.y = Math.round((editor.height - m.h) / 2); changed(); syncXY();
        } }, h('span', null, '세로 가운데')),
      ),
    );
  }

  function syncXY() {
    const layer = current();
    if (!layer) return;
    if (xInput) xInput.value = String(Math.round(layer.x));
    if (yInput) yInput.value = String(Math.round(layer.y));
  }

  // ----- 포인터 끌기 -----
  let drag = null;
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy, scale: sx };
  }
  function hitTest(p) {
    const pad = 10 * p.scale;
    for (let i = editor.textLayers.length - 1; i >= 0; i--) {
      const l = editor.textLayers[i];
      const m = measureLayer(c, l);
      if (p.x >= m.x - pad && p.x <= m.x + m.w + pad && p.y >= m.y - pad && p.y <= m.y + m.h + pad) return l;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = toCanvas(e);
    const hit = hitTest(p);
    if (!hit) {
      if (selectedId) { selectedId = null; renderLayerList(); renderProps(); redraw(); }
      return;
    }
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    if (selectedId !== hit.id) { selectedId = hit.id; renderLayerList(); renderProps(); }
    drag = { id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y, moved: false, pid: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
    canvas.classList.add('is-dragging');
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) {
      if (!drag && e.pointerType === 'mouse') canvas.style.cursor = hitTest(toCanvas(e)) ? 'move' : 'default';
      return;
    }
    const layer = current();
    if (!layer) return;
    const p = toCanvas(e);
    layer.x = clamp(Math.round(p.x - drag.dx), -editor.width, editor.width * 2);
    layer.y = clamp(Math.round(p.y - drag.dy), -editor.height, editor.height * 2);
    if (!drag.moved) { drag.moved = true; ctx.markDirty(); }
    redraw();
    syncXY();
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    drag = null;
    canvas.classList.remove('is-dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('keydown', (e) => {
    const layer = current();
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === 'Escape' && selectedId) {
      selectedId = null; renderLayerList(); renderProps(); redraw();
      return;
    }
    if (e.key === 'Tab' || !layer) {
      if (!layer && moves[e.key] && editor.textLayers.length) {
        e.preventDefault();
        select(editor.textLayers[editor.textLayers.length - 1].id);
      }
      return;
    }
    if (moves[e.key]) {
      e.preventDefault();
      layer.x = clamp(layer.x + moves[e.key][0], -editor.width, editor.width * 2);
      layer.y = clamp(layer.y + moves[e.key][1], -editor.height, editor.height * 2);
      ctx.markDirty();
      redraw();
      syncXY();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      removeLayer(layer.id);
    }
  });

  async function downloadPng() {
    downloadBtn.disabled = true;
    try {
      if (editor.baseAssetId) await waitImage(editor.baseAssetId);
      const off = document.createElement('canvas');
      off.width = editor.width;
      off.height = editor.height;
      const { missingImage } = drawScene(off.getContext('2d'), editor, { selectedId: null });
      const blob = await new Promise((resolve) => off.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG 생성 실패');
      downloadBlob(blob, `${safeFileName(ctx.projectTitle())}-${editor.width}x${editor.height}.png`);
      ctx.notify(missingImage ? '배경 이미지 없이 PNG를 만들었습니다. 이미지를 확인해 주세요.' : 'PNG 파일을 내려받았습니다.', missingImage ? 'error' : 'success');
    } catch {
      ctx.notify('PNG 파일을 만들지 못했습니다. 다시 시도해 주세요.', 'error');
    } finally {
      downloadBtn.disabled = false;
    }
  }

  renderImagePanel();
  renderLayerList();
  renderProps();
  redraw();
}

function swatchRow(colors, label, onPick) {
  const row = h('div', { class: 'swatches', role: 'group', 'aria-label': `${label} 빠른 선택` });
  for (const hex of colors) {
    const b = h('button', { type: 'button', class: 'swatch', 'aria-label': `${label} ${hex}`, title: hex, onclick: () => onPick(hex) });
    b.style.setProperty('--sw', hex);
    row.append(b);
  }
  return row;
}
