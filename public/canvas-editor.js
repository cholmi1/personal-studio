// 이미지 · 썸네일 캔버스 편집기. 모든 그리기는 브라우저 Canvas 에서만 이루어진다.
// 구성 순서: 배경색 -> 배경 이미지 -> 이미지 레이어(합성 보드) -> 텍스트 레이어.
import { h, append, clear, uid, clamp, isHexColor, downloadBlob, safeFileName } from './dom.js';
import { icon } from './icons.js';
import { assetUrl } from './api.js';
import { openSketchPad } from './sketch.js';

export const RATIOS = [
  { w: 1280, h: 720, label: '가로 16:9', sub: '1280×720' },
  { w: 1080, h: 1920, label: '세로 9:16', sub: '1080×1920' },
  { w: 1080, h: 1080, label: '정사각 1:1', sub: '1080×1080' },
  { w: 1440, h: 1080, label: '4:3', sub: '1440×1080' },
  { w: 1080, h: 1440, label: '3:4', sub: '1080×1440' },
];
export const MAX_LAYERS = 20;
export const MAX_IMAGE_LAYERS = 8;
const MAX_LAYER_TEXT = 500;
const MAX_STROKE = 60;
const MIN_IMG = 8;
const MAX_IMG = 20000;

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
const STROKE_SWATCHES = ['#000000', '#ffffff', '#24221e', '#47614b', '#b65c42', '#e2b04a'];

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
    strokeColor: '#000000',
    strokeWidth: 0,
  };
}

function isDark(hex) {
  if (!isHexColor(hex)) return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

// ---------- 이미지 캐시 ----------
const imageCache = new Map(); // id -> { img, status, waiters }

function getImage(id, onReady) {
  if (!id) return null;
  let entry = imageCache.get(id);
  if (!entry) {
    const img = new Image();
    entry = { img, status: 'loading', waiters: [] };
    imageCache.set(id, entry);
    const done = (status) => { entry.status = status; entry.waiters.splice(0).forEach((f) => f()); };
    img.onload = () => done('ok');
    img.onerror = () => done('error');
    img.decoding = 'async';
    img.src = assetUrl({ id });
  }
  if (entry.status === 'loading' && onReady && !entry.waiters.includes(onReady)) entry.waiters.push(onReady);
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

function loadedImage(id) {
  const entry = id ? getImage(id) : null;
  return entry && entry.status === 'ok' ? entry.img : null;
}

// ---------- 그리기 ----------
function layerLines(layer) {
  return String(layer.text ?? '').split('\n');
}

function setFont(c, layer) {
  c.font = `700 ${clamp(Number(layer.fontSize) || 48, 6, 600)}px ${fontStack(layer.fontFamily)}`;
}

function strokeOf(layer) {
  return clamp(Number(layer.strokeWidth) || 0, 0, MAX_STROKE);
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

function imageBox(layer) {
  return {
    x: Number(layer.x) || 0,
    y: Number(layer.y) || 0,
    w: clamp(Number(layer.w) || MIN_IMG, MIN_IMG, MAX_IMG),
    h: clamp(Number(layer.h) || MIN_IMG, MIN_IMG, MAX_IMG),
  };
}

function drawImageFit(c, img, W, H, fit) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  const scale = fit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
  const dw = iw * scale, dh = ih * scale;
  c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawPlaceholder(c, box, label, W) {
  const lw = Math.max(2, W / 480);
  c.save();
  c.fillStyle = 'rgba(245, 240, 230, 0.75)';
  c.fillRect(box.x, box.y, box.w, box.h);
  c.lineWidth = lw;
  c.setLineDash([lw * 5, lw * 4]);
  c.strokeStyle = '#a8513a';
  c.strokeRect(box.x + lw / 2, box.y + lw / 2, box.w - lw, box.h - lw);
  c.setLineDash([]);
  const size = clamp(Math.min(box.w, box.h) * 0.12, 12, 64);
  c.font = `700 ${size}px ${FONT_STACKS['sans-serif']}`;
  c.fillStyle = '#7d3524';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(label, box.x + box.w / 2, box.y + box.h / 2, Math.max(10, box.w - 8));
  c.restore();
}

function handleSize(W, H) {
  return Math.max(14, Math.round(Math.min(W, H) / 36));
}

function drawSelectionBox(c, x, y, w, hgt, W, withHandle, H) {
  const lw = Math.max(2, W / 480);
  c.save();
  c.lineWidth = lw;
  c.setLineDash([lw * 4, lw * 3]);
  c.strokeStyle = '#ffffff';
  c.strokeRect(x, y, w, hgt);
  c.lineDashOffset = lw * 3.5;
  c.strokeStyle = '#47614b';
  c.strokeRect(x, y, w, hgt);
  c.setLineDash([]);
  if (withHandle) {
    const hs = handleSize(W, H);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#47614b';
    c.lineWidth = lw * 1.2;
    c.fillRect(x + w - hs / 2, y + hgt - hs / 2, hs, hs);
    c.strokeRect(x + w - hs / 2, y + hgt - hs / 2, hs, hs);
  }
  c.restore();
}

/**
 * 장면 전체를 그린다.
 * @param {{selected?: {kind:'text'|'image', id:string}|null, selectedId?: string|null, onImageReady?: Function|null, exporting?: boolean}} opts
 * @returns {{missingImage: boolean, missingLayers: number}}
 */
export function drawScene(c, editor, { selected = null, selectedId = null, onImageReady = null, exporting = false } = {}) {
  const sel = exporting ? null : (selected || (selectedId ? { kind: 'text', id: selectedId } : null));
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

  // 이미지 레이어 (배열 순서대로, 뒤에 있는 것이 앞쪽)
  let missingLayers = 0;
  const imageLayers = Array.isArray(editor.imageLayers) ? editor.imageLayers : [];
  for (const layer of imageLayers) {
    const box = imageBox(layer);
    const entry = getImage(layer.assetId, onImageReady);
    if (entry && entry.status === 'ok') {
      c.globalAlpha = clamp(layer.opacity === undefined ? 1 : Number(layer.opacity), 0, 1);
      c.drawImage(entry.img, box.x, box.y, box.w, box.h);
      c.globalAlpha = 1;
    } else {
      const failed = !entry || entry.status === 'error';
      if (failed) missingLayers += 1;
      if (!exporting) drawPlaceholder(c, box, failed ? '이미지 없음' : '불러오는 중…', W);
    }
  }

  // 텍스트 레이어: 외곽선을 먼저 모두 그린 뒤 글자를 채운다.
  for (const layer of editor.textLayers) {
    const m = measureLayer(c, layer);
    const align = ['left', 'center', 'right'].includes(layer.align) ? layer.align : 'left';
    c.textAlign = align;
    c.textBaseline = 'top';
    const s = Number(layer.fontSize) || 48;
    const sw = strokeOf(layer);
    const lines = layerLines(layer);
    const x = Number(layer.x) || 0;
    const lineY = (i) => m.y + i * m.lineH + m.lineH * 0.1;
    const setShadow = (on) => {
      if (on) {
        c.shadowColor = 'rgba(0, 0, 0, 0.5)';
        c.shadowBlur = Math.max(2, s * 0.14);
        c.shadowOffsetX = Math.max(1, s * 0.04);
        c.shadowOffsetY = Math.max(1, s * 0.05);
      } else {
        c.shadowColor = 'transparent';
        c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
      }
    };
    if (sw > 0) {
      setShadow(!!layer.shadow);
      c.lineJoin = 'round';
      c.miterLimit = 2;
      c.lineWidth = sw * 2; // 글자 바깥쪽으로 보이는 두께가 sw 가 되도록
      c.strokeStyle = isHexColor(layer.strokeColor) ? layer.strokeColor : '#000000';
      lines.forEach((line, i) => c.strokeText(line, x, lineY(i)));
      setShadow(false);
    } else {
      setShadow(!!layer.shadow);
    }
    c.fillStyle = isHexColor(layer.color) ? layer.color : '#24221e';
    lines.forEach((line, i) => c.fillText(line, x, lineY(i)));
    setShadow(false);
  }

  // 선택 표시 (내보내기에는 포함하지 않음)
  if (sel && sel.kind === 'text') {
    const layer = editor.textLayers.find((l) => l.id === sel.id);
    if (layer) {
      const m = measureLayer(c, layer);
      const pad = Math.max(6, W / 160) + strokeOf(layer);
      drawSelectionBox(c, m.x - pad, m.y - pad, m.w + pad * 2, m.h + pad * 2, W, false, H);
    }
  } else if (sel && sel.kind === 'image') {
    const layer = imageLayers.find((l) => l.id === sel.id);
    if (layer) {
      const b = imageBox(layer);
      drawSelectionBox(c, b.x, b.y, b.w, b.h, W, true, H);
    }
  }
  c.restore();
  return { missingImage, missingLayers };
}

async function composeCanvas(editor) {
  const ids = [editor.baseAssetId, ...(Array.isArray(editor.imageLayers) ? editor.imageLayers.map((l) => l.assetId) : [])].filter(Boolean);
  await Promise.all([...new Set(ids)].map((id) => waitImage(id)));
  const off = document.createElement('canvas');
  off.width = editor.width;
  off.height = editor.height;
  const result = drawScene(off.getContext('2d'), editor, { exporting: true });
  return { canvas: off, ...result };
}

/** 현재 구성 전체(배경·이미지 레이어·문구)를 PNG Blob 으로 만든다. 선택 표시는 포함하지 않는다. */
export async function renderEditorToBlob(editor) {
  const { canvas } = await composeCanvas(editor);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 생성 실패');
  return blob;
}

// ---------- 편집기 UI ----------
let selected = null; // { kind: 'text' | 'image', id }
let keepRatio = true;

/**
 * @param {HTMLElement} root
 * @param {{ getState: () => any, markDirty: () => void, notify: Function, getAssets: () => any[],
 *           uploadFiles: (files: File[]) => Promise<any[]>, uploadBlob?: (blob: Blob, name: string) => Promise<any|null>,
 *           projectTitle: () => string, aiBlocked: Function, confirm?: Function }} ctx
 */
export function renderEditor(root, ctx) {
  clear(root);
  const editor = ctx.getState().editor;
  if (!Array.isArray(editor.imageLayers)) editor.imageLayers = [];
  if (selected && !findLayer(selected)) selected = null;

  function findLayer(sel) {
    if (!sel) return null;
    const list = sel.kind === 'image' ? editor.imageLayers : editor.textLayers;
    return list.find((l) => l.id === sel.id) || null;
  }

  const canvas = h('canvas', {
    class: 'stage-canvas',
    width: editor.width,
    height: editor.height,
    tabIndex: 0,
    'aria-roledescription': '편집 캔버스',
    'aria-label': '썸네일 캔버스. 문구나 이미지 레이어를 선택한 뒤 방향키로 이동, Shift와 함께 누르면 10픽셀씩 이동, Delete로 삭제, Esc로 선택 해제.',
  });
  const c = canvas.getContext('2d');
  const sizeLabel = h('span', { class: 'counter' });
  const imageWarn = h('p', { class: 'warn-line', hidden: true, role: 'status' });
  const downloadBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: downloadPng }, icon('download'), h('span', null, 'PNG 내려받기'));

  const aiPrompt = h('textarea', { id: 'canvas-ai-prompt', class: 'input', rows: 2, maxLength: 4000, placeholder: '생성할 배경 이미지를 설명하세요. 문구는 생성 후 텍스트 레이어로 넣는 것을 권장합니다.' });
  const aiRef = h('input', { type: 'checkbox', id: 'canvas-ai-ref' });
  const aiBtn = h('button', { type: 'button', class: 'btn btn-ai', onclick: async () => {
    if (!ctx.ai?.ready('openai')) { ctx.ai?.open(); return; }
    if (aiBtn.disabled) return;
    const prompt = aiPrompt.value.trim();
    if (!prompt) { ctx.notify('생성할 이미지 설명을 입력해 주세요.', 'error'); aiPrompt.focus(); return; }
    if (editor.baseAssetId && !await ctx.confirm({ title: '배경 이미지 바꾸기', message: '생성한 이미지로 캔버스 배경을 바꿀까요? 기존 이미지는 자료함에 남고 텍스트·레이어도 유지됩니다.', okLabel: '계속' })) return;
    aiBtn.disabled = true; aiBtn.setAttribute('aria-busy', 'true');
    try {
      const result = await ctx.ai.image({ prompt, assetIds: aiRef.checked && editor.baseAssetId ? [editor.baseAssetId] : [], size: editor.width === editor.height ? '1024x1024' : editor.width > editor.height ? '1536x1024' : '1024x1536' });
      if (!result?.asset) return;
      editor.baseAssetId = result.asset.id; ctx.markDirty(); redraw(); renderImagePanel();
      ctx.notify('생성 이미지를 배경으로 넣었습니다. 저장해 주세요.', 'success');
    } catch (err) { ctx.notify(err.message || '이미지 생성에 실패했습니다.', 'error'); }
    finally { aiBtn.disabled = false; aiBtn.removeAttribute('aria-busy'); }
  } }, icon('plug'), h('span', null, 'AI 이미지 생성'), h('span', { class: 'badge' }, ctx.ai?.ready('openai') ? 'API' : '키 설정'));

  const stagePanel = h('section', { class: 'panel stage-panel', 'aria-labelledby': 'stage-heading' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'stage-heading', class: 'panel-title' }, icon('image'), '캔버스'),
      sizeLabel,
    ),
    h('div', { class: 'stage' }, canvas),
    imageWarn,
    h('p', { class: 'hint' }, icon('info', 'icon-sm'), '문구·이미지를 끌어서 옮기고, 선택한 이미지의 오른쪽 아래 모서리를 끌어 크기를 바꿉니다(Shift: 비율 무시). 캔버스를 선택(Tab)한 뒤 방향키로 1px, Shift+방향키로 10px씩 움직입니다.'),
    h('div', { class: 'field' }, h('label', { htmlFor: 'canvas-ai-prompt' }, 'AI 이미지 설명'), aiPrompt, h('label', { class: 'check', htmlFor: 'canvas-ai-ref' }, aiRef, h('span', null, '현재 배경 이미지를 참조로 전송'))),
    h('div', { class: 'stage-actions' },
      downloadBtn,
      aiBtn,
    ),
  );

  const side = h('div', { class: 'editor-side' });
  root.append(h('div', { class: 'editor-grid' }, stagePanel, side));

  // ----- 캔버스 설정 패널 -----
  const ratioGroup = h('div', { class: 'seg seg-ratios', role: 'radiogroup', 'aria-label': '캔버스 비율' });
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

  // ----- 이미지 레이어 패널 (합성 보드) -----
  const imgLayerPanel = h('section', { class: 'panel', 'aria-labelledby': 'imglayers-heading' });
  side.append(imgLayerPanel);

  // ----- 텍스트 레이어 패널 -----
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

  // ---------- 공통 동작 ----------
  function redraw() {
    const { missingImage, missingLayers } = drawScene(c, editor, { selected, onImageReady: redraw });
    const warns = [];
    if (missingImage) warns.push('배경 이미지를 불러오지 못했습니다. 자료가 삭제되었거나 로그인 세션이 끝났을 수 있습니다.');
    if (missingLayers) warns.push(`이미지 레이어 ${missingLayers}개의 이미지를 불러오지 못했습니다. 해당 레이어를 삭제하거나 다른 이미지로 바꿔 주세요.`);
    imageWarn.hidden = !warns.length;
    imageWarn.textContent = warns.join(' ');
    sizeLabel.textContent = `${editor.width}×${editor.height}px · 이미지 ${editor.imageLayers.length}개 · 문구 ${editor.textLayers.length}개`;
  }

  function refreshAll() {
    renderImageLayerPanel();
    renderLayerList();
    renderProps();
    redraw();
  }

  function select(sel, focusProps = false) {
    selected = sel;
    refreshAll();
    if (focusProps) {
      const target = sel && sel.kind === 'image' ? 'img-opacity' : 'layer-text';
      document.getElementById(target)?.focus();
    }
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
    // 이미지는 찌그러지지 않도록 중심 위치는 비율대로, 크기는 같은 배율로 맞춘다.
    const s = Math.min(sx, sy);
    for (const l of editor.imageLayers) {
      const b = imageBox(l);
      const cx = (b.x + b.w / 2) * sx, cy = (b.y + b.h / 2) * sy;
      l.w = clamp(Math.round(b.w * s), MIN_IMG, MAX_IMG);
      l.h = clamp(Math.round(b.h * s), MIN_IMG, MAX_IMG);
      l.x = clampPos(Math.round(cx - l.w / 2), r.w);
      l.y = clampPos(Math.round(cy - l.h / 2), r.h);
    }
    editor.width = r.w;
    editor.height = r.h;
    canvas.width = r.w;
    canvas.height = r.h;
    ctx.markDirty();
    redraw();
    renderProps();
  }

  function clampPos(v, size) {
    return clamp(v, -size * 2, size * 3);
  }

  function setBackground(hex) {
    if (!isHexColor(hex)) return;
    editor.background = hex.toLowerCase();
    ctx.markDirty();
    redraw();
  }

  // ---------- 배경 이미지 ----------
  function renderImagePanel() {
    clear(imagePanel);
    const assets = ctx.getAssets();
    const sel = h('select', { id: 'base-asset', class: 'input' }, h('option', { value: '' }, '이미지 없음'));
    let found = !editor.baseAssetId;
    for (const a of assets) {
      const opt = h('option', { value: a.id }, a.name || '이름 없는 이미지');
      if (a.id === editor.baseAssetId) { opt.selected = true; found = true; }
      sel.append(opt);
    }
    if (!found) sel.append(h('option', { value: editor.baseAssetId, selected: true }, '(찾을 수 없는 이미지)'));
    sel.addEventListener('change', () => {
      editor.baseAssetId = sel.value || null;
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
        renderImageLayerPanel();
      }
    });

    append(imagePanel, [
      h('h3', { id: 'image-set-heading', class: 'panel-subtitle' }, '배경 이미지'),
      h('div', { class: 'field' }, h('label', { htmlFor: 'base-asset' }, '자료에서 고르기'), sel),
      fitGroup,
      h('div', { class: 'btn-row' },
        fileInput,
        fileButton('editor-upload', fileInput, '새 이미지 올리기'),
        editor.baseAssetId ? h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => {
          editor.baseAssetId = null; ctx.markDirty(); redraw(); renderImagePanel();
        } }, '이미지 빼기') : null,
      ),
      assets.length ? null : h('p', { class: 'hint' }, 'PNG·JPEG·WebP 이미지를 올리면 이 작업의 자료에도 보관됩니다.'),
    ]);
  }

  // ---------- 이미지 레이어 ----------
  function assetName(id) {
    const a = ctx.getAssets().find((x) => x.id === id);
    return a ? (a.name || '이름 없는 이미지') : '(찾을 수 없는 이미지)';
  }

  function currentImage() {
    return selected && selected.kind === 'image' ? editor.imageLayers.find((l) => l.id === selected.id) || null : null;
  }

  function naturalRatio(layer) {
    const img = loadedImage(layer.assetId);
    if (img && img.naturalWidth && img.naturalHeight) return img.naturalWidth / img.naturalHeight;
    return null;
  }

  async function addImageLayer(assetId, { cover = false } = {}) {
    if (editor.imageLayers.length >= MAX_IMAGE_LAYERS) {
      ctx.notify(`이미지 레이어는 최대 ${MAX_IMAGE_LAYERS}개까지 넣을 수 있습니다.`, 'error');
      return null;
    }
    const entry = await waitImage(assetId);
    const W = editor.width, H = editor.height;
    let w, hh;
    if (cover) {
      w = W; hh = H;
    } else {
      const iw = entry && entry.status === 'ok' ? entry.img.naturalWidth : 0;
      const ih = entry && entry.status === 'ok' ? entry.img.naturalHeight : 0;
      if (iw && ih) {
        const s = Math.min((W * 0.5) / iw, (H * 0.5) / ih);
        w = iw * s; hh = ih * s;
      } else {
        w = hh = Math.min(W, H) * 0.5;
      }
    }
    if (editor.imageLayers.length >= MAX_IMAGE_LAYERS) return null; // 기다리는 동안 다른 추가가 있었을 때
    const layer = {
      id: uid('img'),
      assetId,
      x: Math.round((W - w) / 2),
      y: Math.round((H - hh) / 2),
      w: clamp(Math.round(w), MIN_IMG, MAX_IMG),
      h: clamp(Math.round(hh), MIN_IMG, MAX_IMG),
      opacity: 1,
    };
    editor.imageLayers.push(layer);
    ctx.markDirty();
    select({ kind: 'image', id: layer.id });
    if (!entry || entry.status !== 'ok') ctx.notify('이미지를 불러오지 못해 정사각 자리 표시로 넣었습니다.', 'error');
    return layer;
  }

  function removeImageLayer(id) {
    const i = editor.imageLayers.findIndex((l) => l.id === id);
    if (i < 0) return;
    editor.imageLayers.splice(i, 1);
    if (selected && selected.kind === 'image' && selected.id === id) selected = null;
    ctx.markDirty();
    refreshAll();
    ctx.notify('이미지 레이어를 뺐습니다. 자료함의 원본은 그대로 있습니다. 저장해야 서버에 반영됩니다.', 'info');
  }

  function reorderImage(idx, delta) {
    const to = idx + delta;
    if (to < 0 || to >= editor.imageLayers.length) return;
    const [l] = editor.imageLayers.splice(idx, 1);
    editor.imageLayers.splice(to, 0, l);
    ctx.markDirty();
    renderImageLayerPanel();
    redraw();
    const row = imgLayerPanel.querySelector(`[data-id="${CSS.escape(l.id)}"]`);
    row?.querySelector(delta > 0 ? '[data-act="up"]' : '[data-act="down"]')?.focus();
  }

  async function openSketch() {
    if (typeof ctx.uploadBlob !== 'function') {
      ctx.notify('스케치를 자료함에 저장하는 기능을 사용할 수 없습니다.', 'error');
      return;
    }
    const img = currentImage();
    const baseImage = (img && loadedImage(img.assetId)) || loadedImage(editor.baseAssetId) || null;
    const asset = await openSketchPad({
      width: editor.width,
      height: editor.height,
      background: 'transparent',
      baseImage,
      uploadBlob: ctx.uploadBlob,
      notify: ctx.notify,
      title: '스케치 그리기',
    });
    if (!asset) return;
    if (ctx.getState().editor !== editor || !root.isConnected) return; // 다른 작업으로 바뀐 경우
    if (editor.imageLayers.length >= MAX_IMAGE_LAYERS) {
      ctx.notify('스케치를 자료함에 저장했습니다. 이미지 레이어가 가득 차서 캔버스에는 넣지 않았습니다.', 'info');
      renderImageLayerPanel();
      renderImagePanel();
      return;
    }
    const layer = await addImageLayer(asset.id, { cover: true });
    renderImagePanel();
    if (layer) ctx.notify('스케치를 자료함에 저장하고 캔버스 전체 크기의 이미지 레이어로 넣었습니다. 저장을 눌러 보관하세요.', 'success');
  }

  function renderImageLayerPanel() {
    clear(imgLayerPanel);
    const assets = ctx.getAssets();
    const n = editor.imageLayers.length;
    const full = n >= MAX_IMAGE_LAYERS;

    const pick = h('select', { id: 'imglayer-asset', class: 'input' }, h('option', { value: '' }, assets.length ? '자료 이미지 고르기' : '자료함이 비어 있습니다'));
    for (const a of assets) pick.append(h('option', { value: a.id }, a.name || '이름 없는 이미지'));
    pick.disabled = !assets.length || full;
    const addBtn = h('button', { type: 'button', class: 'btn btn-sm', disabled: true, onclick: async () => {
      if (!pick.value) return;
      addBtn.disabled = true;
      await addImageLayer(pick.value);
    } }, icon('plus', 'icon-sm'), h('span', null, '레이어로 추가'));
    pick.addEventListener('change', () => { addBtn.disabled = !pick.value || full; });

    const fileInput = h('input', { type: 'file', id: 'imglayer-upload', class: 'sr-only', multiple: true, accept: 'image/png,image/jpeg,image/webp' });
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      if (!files.length) return;
      const room = MAX_IMAGE_LAYERS - editor.imageLayers.length;
      const created = (await ctx.uploadFiles(files)) || [];
      for (const a of created.slice(0, Math.max(0, room))) await addImageLayer(a.id);
      if (created.length > room) ctx.notify(`자료함에는 ${created.length}개를 올렸지만 레이어는 ${Math.max(0, room)}개만 넣었습니다. (최대 ${MAX_IMAGE_LAYERS}개)`, 'info');
      renderImagePanel();
      renderImageLayerPanel();
    });

    const list = h('ul', { class: 'layer-list', 'aria-label': '이미지 레이어 (위에 있는 것이 앞쪽)' });
    if (!n) {
      list.append(h('li', { class: 'empty-note small' }, h('p', { class: 'muted' }, '이미지 레이어가 없습니다. 자료나 스케치를 여러 장 겹쳐 컨셉 보드를 만들어 보세요.')));
    }
    for (let vi = 0; vi < n; vi++) {
      const idx = n - 1 - vi;
      const layer = editor.imageLayers[idx];
      const isSel = !!(selected && selected.kind === 'image' && selected.id === layer.id);
      const thumb = h('img', { class: 'layer-thumb', src: assetUrl({ id: layer.assetId }), alt: '', loading: 'lazy', decoding: 'async' });
      thumb.addEventListener('error', () => thumb.replaceWith(icon('alert', 'icon-sm')));
      list.append(h('li', { class: `layer-row${isSel ? ' is-selected' : ''}`, dataset: { id: layer.id } },
        h('button', { type: 'button', class: 'layer-pick', 'aria-pressed': String(isSel), onclick: () => select({ kind: 'image', id: layer.id }, true) },
          thumb, h('span', { class: 'layer-name' }, assetName(layer.assetId))),
        h('button', { type: 'button', class: 'icon-btn', 'data-act': 'up', 'aria-label': '앞으로 가져오기', disabled: idx === n - 1, onclick: () => reorderImage(idx, 1) }, icon('up')),
        h('button', { type: 'button', class: 'icon-btn', 'data-act': 'down', 'aria-label': '뒤로 보내기', disabled: idx === 0, onclick: () => reorderImage(idx, -1) }, icon('down')),
        h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': '이미지 레이어 빼기', onclick: () => removeImageLayer(layer.id) }, icon('trash')),
      ));
    }

    append(imgLayerPanel, [
      h('div', { class: 'panel-head' },
        h('h3', { id: 'imglayers-heading', class: 'panel-subtitle' }, icon('layers', 'icon-sm'), `이미지 레이어 (${n}/${MAX_IMAGE_LAYERS})`),
      ),
      h('p', { class: 'hint' }, '자료 이미지 여러 장을 한 캔버스에 겹쳐 배치하는 합성 보드입니다. 이미지 레이어는 배경 이미지 위, 문구 아래에 그려집니다.'),
      h('div', { class: 'field' },
        h('label', { htmlFor: 'imglayer-asset' }, '자료에서 추가'),
        h('div', { class: 'inline-pick' }, pick, addBtn),
      ),
      h('div', { class: 'btn-row' },
        fileInput,
        fileButton('imglayer-upload', fileInput, '새 이미지 올려 추가', full),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: openSketch }, icon('pen', 'icon-sm'), h('span', null, '스케치 그리기')),
      ),
      full ? h('p', { class: 'hint' }, `이미지 레이어가 가득 찼습니다 (최대 ${MAX_IMAGE_LAYERS}개). 스케치는 자료함에만 저장됩니다.`) : null,
      list,
    ]);
  }

  // ---------- 텍스트 레이어 ----------
  function layerLabel(layer) {
    const t = String(layer.text || '').replace(/\s+/g, ' ').trim();
    return t ? (t.length > 22 ? t.slice(0, 22) + '…' : t) : '(빈 문구)';
  }

  function currentText() {
    return selected && selected.kind === 'text' ? editor.textLayers.find((l) => l.id === selected.id) || null : null;
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
      const isSel = !!(selected && selected.kind === 'text' && selected.id === layer.id);
      const row = h('li', { class: `layer-row${isSel ? ' is-selected' : ''}`, dataset: { id: layer.id } },
        h('button', { type: 'button', class: 'layer-pick', 'aria-pressed': String(isSel), onclick: () => select({ kind: 'text', id: layer.id }, true) },
          icon('text', 'icon-sm'), h('span', { class: 'layer-name' }, layerLabel(layer))),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '앞으로 가져오기', disabled: idx === n - 1, onclick: () => reorder(idx, 1) }, icon('up')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '뒤로 보내기', disabled: idx === 0, onclick: () => reorder(idx, -1) }, icon('down')),
        h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': '문구 삭제', onclick: () => removeLayer(layer.id) }, icon('trash')),
      );
      layerList.append(row);
    }
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
    select({ kind: 'text', id: layer.id }, true);
    document.getElementById('layer-text')?.select();
  }

  function removeLayer(id) {
    const i = editor.textLayers.findIndex((l) => l.id === id);
    if (i < 0) return;
    editor.textLayers.splice(i, 1);
    if (selected && selected.kind === 'text' && selected.id === id) selected = null;
    ctx.markDirty();
    renderLayerList();
    renderProps();
    redraw();
    ctx.notify('문구를 삭제했습니다. 저장해야 서버에 반영됩니다.', 'info');
  }

  // ---------- 속성 패널 ----------
  let refs = {};

  function renderProps() {
    clear(propsPanel);
    refs = {};
    const text = currentText();
    const img = currentImage();
    if (text) return renderTextProps(text);
    if (img) return renderImageProps(img);
    propsPanel.append(
      h('h3', { id: 'props-heading', class: 'panel-subtitle' }, '선택한 레이어'),
      h('p', { class: 'muted small-text' }, '캔버스나 목록에서 문구를 고르면 글자 크기·색·외곽선·그림자를, 이미지 레이어를 고르면 크기·투명도를 바꿀 수 있습니다.'),
    );
  }

  function renderTextProps(layer) {
    const changed = () => { ctx.markDirty(); redraw(); };

    const text = h('textarea', { id: 'layer-text', class: 'input', rows: 2, value: layer.text, maxLength: MAX_LAYER_TEXT });
    text.addEventListener('input', () => {
      layer.text = text.value;
      changed();
      const nameEl = layerList.querySelector(`[data-id="${CSS.escape(layer.id)}"] .layer-name`);
      if (nameEl) nameEl.textContent = layerLabel(layer);
    });

    const size = numberRange({ id: 'layer-size', min: 8, max: 400, step: 1, value: layer.fontSize, label: '글자 크기 조절',
      onSet: (n) => { layer.fontSize = n; changed(); } });

    const color = h('input', { id: 'layer-color', class: 'color-input', type: 'color', value: isHexColor(layer.color) ? layer.color : '#24221e' });
    color.addEventListener('input', () => { layer.color = color.value.toLowerCase(); changed(); });
    const colorSw = swatchRow(TEXT_SWATCHES, '글자색', (hex) => { color.value = hex; layer.color = hex; changed(); });

    const stroke = numberRange({ id: 'layer-stroke', min: 0, max: MAX_STROKE, step: 1, value: strokeOf(layer), label: '외곽선 두께 조절',
      onSet: (n) => { layer.strokeWidth = n; changed(); } });
    const strokeColor = h('input', { id: 'layer-stroke-color', class: 'color-input', type: 'color', value: isHexColor(layer.strokeColor) ? layer.strokeColor : '#000000' });
    strokeColor.addEventListener('input', () => { layer.strokeColor = strokeColor.value.toLowerCase(); changed(); });
    const strokeSw = swatchRow(STROKE_SWATCHES, '외곽선 색', (hex) => {
      strokeColor.value = hex; layer.strokeColor = hex;
      if (!strokeOf(layer)) { layer.strokeWidth = 4; stroke.set(4, false); }
      changed();
    });

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

    const W = editor.width, H = editor.height;
    refs.x = h('input', { id: 'layer-x', class: 'input num', type: 'number', step: 1, value: String(Math.round(layer.x)), inputmode: 'numeric' });
    refs.y = h('input', { id: 'layer-y', class: 'input num', type: 'number', step: 1, value: String(Math.round(layer.y)), inputmode: 'numeric' });
    refs.x.addEventListener('change', () => { layer.x = clamp(Math.round(Number(refs.x.value) || 0), -W, W * 2); changed(); });
    refs.y.addEventListener('change', () => { layer.y = clamp(Math.round(Number(refs.y.value) || 0), -H, H * 2); changed(); });

    propsPanel.append(
      h('div', { class: 'panel-head' },
        h('h3', { id: 'props-heading', class: 'panel-subtitle' }, '선택한 문구'),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet danger-text', onclick: () => removeLayer(layer.id) }, icon('trash', 'icon-sm'), h('span', null, '삭제')),
      ),
      h('div', { class: 'field' }, h('label', { htmlFor: 'layer-text' }, '내용 (줄바꿈 가능)'), text),
      h('div', { class: 'field' }, h('label', { htmlFor: 'layer-size' }, '글자 크기(px)'), size.row),
      h('div', { class: 'field color-field' }, h('label', { htmlFor: 'layer-color' }, '글자색'), h('div', { class: 'color-row' }, color, colorSw)),
      h('div', { class: 'field' }, h('label', { htmlFor: 'layer-stroke' }, '외곽선 두께(px, 0은 없음)'), stroke.row),
      h('div', { class: 'field color-field' }, h('label', { htmlFor: 'layer-stroke-color' }, '외곽선 색'), h('div', { class: 'color-row' }, strokeColor, strokeSw)),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { htmlFor: 'layer-font' }, '글꼴'), font),
        h('div', { class: 'field check-field' }, h('label', { class: 'check', htmlFor: 'layer-shadow' }, shadow, h('span', null, '그림자'))),
      ),
      h('div', { class: 'field' }, h('span', { class: 'label-like', id: 'align-label' }, '정렬'), alignGroup),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { htmlFor: 'layer-x' }, '가로 위치 X'), refs.x),
        h('div', { class: 'field' }, h('label', { htmlFor: 'layer-y' }, '세로 위치 Y'), refs.y),
      ),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => {
          layer.align = 'center'; layer.x = Math.round(editor.width / 2); changed(); renderProps();
        } }, icon('center', 'icon-sm'), h('span', null, '가로 가운데')),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => {
          const m = measureLayer(c, layer); layer.y = Math.round((editor.height - m.h) / 2); changed(); syncProps();
        } }, h('span', null, '세로 가운데')),
      ),
    );
  }

  function renderImageProps(layer) {
    const changed = () => { ctx.markDirty(); redraw(); };
    const W = editor.width, H = editor.height;

    const opacity = numberRange({ id: 'img-opacity', min: 0, max: 100, step: 1, value: Math.round((layer.opacity ?? 1) * 100), label: '불투명도 조절',
      onSet: (n) => { layer.opacity = Math.round(n) / 100; changed(); } });

    const num = (id, value) => h('input', { id, class: 'input num', type: 'number', step: 1, value: String(Math.round(value)), inputmode: 'numeric' });
    refs.x = num('img-x', layer.x);
    refs.y = num('img-y', layer.y);
    refs.w = num('img-w', layer.w);
    refs.h = num('img-h', layer.h);
    refs.w.min = String(MIN_IMG); refs.h.min = String(MIN_IMG);
    refs.x.addEventListener('change', () => { layer.x = clampPos(Math.round(Number(refs.x.value) || 0), W); changed(); syncProps(); });
    refs.y.addEventListener('change', () => { layer.y = clampPos(Math.round(Number(refs.y.value) || 0), H); changed(); syncProps(); });
    const setSize = (which) => {
      const ratio = layer.w / layer.h || 1;
      if (which === 'w') {
        layer.w = clamp(Math.round(Number(refs.w.value) || MIN_IMG), MIN_IMG, MAX_IMG);
        if (keepRatio) layer.h = clamp(Math.round(layer.w / ratio), MIN_IMG, MAX_IMG);
      } else {
        layer.h = clamp(Math.round(Number(refs.h.value) || MIN_IMG), MIN_IMG, MAX_IMG);
        if (keepRatio) layer.w = clamp(Math.round(layer.h * ratio), MIN_IMG, MAX_IMG);
      }
      changed();
      syncProps();
    };
    refs.w.addEventListener('change', () => setSize('w'));
    refs.h.addEventListener('change', () => setSize('h'));

    const keep = h('input', { id: 'img-keep', type: 'checkbox', checked: keepRatio });
    keep.addEventListener('change', () => { keepRatio = keep.checked; });

    const fitInside = () => {
      const r = naturalRatio(layer) || (layer.w / layer.h) || 1;
      let w = W, hh = W / r;
      if (hh > H) { hh = H; w = H * r; }
      layer.w = clamp(Math.round(w), MIN_IMG, MAX_IMG);
      layer.h = clamp(Math.round(hh), MIN_IMG, MAX_IMG);
      layer.x = Math.round((W - layer.w) / 2);
      layer.y = Math.round((H - layer.h) / 2);
      changed();
      syncProps();
    };
    const resetRatio = () => {
      const r = naturalRatio(layer);
      if (!r) { ctx.notify('이미지를 불러오지 못해 원본 비율을 알 수 없습니다.', 'error'); return; }
      layer.h = clamp(Math.round(layer.w / r), MIN_IMG, MAX_IMG);
      changed();
      syncProps();
    };
    const center = () => {
      layer.x = Math.round((W - layer.w) / 2);
      layer.y = Math.round((H - layer.h) / 2);
      changed();
      syncProps();
    };

    propsPanel.append(
      h('div', { class: 'panel-head' },
        h('h3', { id: 'props-heading', class: 'panel-subtitle' }, '선택한 이미지 레이어'),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet danger-text', onclick: () => removeImageLayer(layer.id) }, icon('trash', 'icon-sm'), h('span', null, '빼기')),
      ),
      h('p', { class: 'muted small-text layer-asset-name' }, assetName(layer.assetId)),
      h('div', { class: 'field' }, h('label', { htmlFor: 'img-opacity' }, '불투명도(%)'), opacity.row),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { htmlFor: 'img-w' }, '너비 W'), refs.w),
        h('div', { class: 'field' }, h('label', { htmlFor: 'img-h' }, '높이 H'), refs.h),
      ),
      h('div', { class: 'field check-field' }, h('label', { class: 'check', htmlFor: 'img-keep' }, keep, h('span', null, '비율 유지'))),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { htmlFor: 'img-x' }, '가로 위치 X'), refs.x),
        h('div', { class: 'field' }, h('label', { htmlFor: 'img-y' }, '세로 위치 Y'), refs.y),
      ),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: fitInside }, h('span', null, '캔버스 맞춤')),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: resetRatio }, h('span', null, '원본 비율')),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: center }, icon('center', 'icon-sm'), h('span', null, '가운데')),
      ),
    );
  }

  function syncProps() {
    const layer = currentText() || currentImage();
    if (!layer) return;
    if (refs.x) refs.x.value = String(Math.round(layer.x));
    if (refs.y) refs.y.value = String(Math.round(layer.y));
    if (refs.w) refs.w.value = String(Math.round(layer.w));
    if (refs.h) refs.h.value = String(Math.round(layer.h));
  }

  // ----- 포인터: 선택 · 이동 · 크기 조절 -----
  let drag = null;
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy, scale: sx };
  }
  function hitHandle(p) {
    const layer = currentImage();
    if (!layer) return null;
    const b = imageBox(layer);
    const r = handleSize(editor.width, editor.height) * 0.75 + 6 * p.scale;
    return Math.abs(p.x - (b.x + b.w)) <= r && Math.abs(p.y - (b.y + b.h)) <= r ? layer : null;
  }
  function hitTest(p) {
    const pad = 10 * p.scale;
    for (let i = editor.textLayers.length - 1; i >= 0; i--) {
      const l = editor.textLayers[i];
      const m = measureLayer(c, l);
      if (p.x >= m.x - pad && p.x <= m.x + m.w + pad && p.y >= m.y - pad && p.y <= m.y + m.h + pad) return { kind: 'text', layer: l };
    }
    for (let i = editor.imageLayers.length - 1; i >= 0; i--) {
      const l = editor.imageLayers[i];
      const b = imageBox(l);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { kind: 'image', layer: l };
    }
    return null;
  }
  function sameSel(kind, id) {
    return !!(selected && selected.kind === kind && selected.id === id);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = toCanvas(e);
    const handleLayer = hitHandle(p);
    if (handleLayer) {
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      const b = imageBox(handleLayer);
      drag = { kind: 'image', id: handleLayer.id, mode: 'resize', ratio: b.w / b.h || 1, moved: false, pid: e.pointerId };
    } else {
      const hit = hitTest(p);
      if (!hit) {
        if (selected) { selected = null; refreshAll(); }
        return;
      }
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      if (!sameSel(hit.kind, hit.layer.id)) { selected = { kind: hit.kind, id: hit.layer.id }; renderImageLayerPanel(); renderLayerList(); renderProps(); }
      drag = { kind: hit.kind, id: hit.layer.id, mode: 'move', dx: p.x - hit.layer.x, dy: p.y - hit.layer.y, moved: false, pid: e.pointerId };
    }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
    canvas.classList.add('is-dragging');
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) {
      if (!drag && e.pointerType === 'mouse') {
        const p = toCanvas(e);
        canvas.style.cursor = hitHandle(p) ? 'nwse-resize' : hitTest(p) ? 'move' : 'default';
      }
      return;
    }
    const layer = findLayer(drag);
    if (!layer) return;
    const p = toCanvas(e);
    const W = editor.width, H = editor.height;
    if (drag.mode === 'resize') {
      const lw = Math.max(MIN_IMG, p.x - layer.x);
      const lh = Math.max(MIN_IMG, p.y - layer.y);
      if (e.shiftKey) {
        layer.w = clamp(Math.round(lw), MIN_IMG, MAX_IMG);
        layer.h = clamp(Math.round(lh), MIN_IMG, MAX_IMG);
      } else {
        const w = Math.max(lw, lh * drag.ratio);
        layer.w = clamp(Math.round(w), MIN_IMG, MAX_IMG);
        layer.h = clamp(Math.round(w / drag.ratio), MIN_IMG, MAX_IMG);
      }
    } else if (drag.kind === 'image') {
      layer.x = clampPos(Math.round(p.x - drag.dx), W);
      layer.y = clampPos(Math.round(p.y - drag.dy), H);
    } else {
      layer.x = clamp(Math.round(p.x - drag.dx), -W, W * 2);
      layer.y = clamp(Math.round(p.y - drag.dy), -H, H * 2);
    }
    if (!drag.moved) { drag.moved = true; ctx.markDirty(); }
    redraw();
    syncProps();
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    drag = null;
    canvas.classList.remove('is-dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('keydown', (e) => {
    const layer = findLayer(selected);
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === 'Escape' && selected) {
      selected = null; refreshAll();
      return;
    }
    if (e.key === 'Tab' || !layer) {
      if (!layer && moves[e.key]) {
        if (editor.textLayers.length) {
          e.preventDefault();
          select({ kind: 'text', id: editor.textLayers[editor.textLayers.length - 1].id });
        } else if (editor.imageLayers.length) {
          e.preventDefault();
          select({ kind: 'image', id: editor.imageLayers[editor.imageLayers.length - 1].id });
        }
      }
      return;
    }
    const W = editor.width, H = editor.height;
    if (moves[e.key]) {
      e.preventDefault();
      if (selected.kind === 'image') {
        layer.x = clampPos(layer.x + moves[e.key][0], W);
        layer.y = clampPos(layer.y + moves[e.key][1], H);
      } else {
        layer.x = clamp(layer.x + moves[e.key][0], -W, W * 2);
        layer.y = clamp(layer.y + moves[e.key][1], -H, H * 2);
      }
      ctx.markDirty();
      redraw();
      syncProps();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      if (selected.kind === 'image') removeImageLayer(layer.id);
      else removeLayer(layer.id);
    }
  });

  async function downloadPng() {
    downloadBtn.disabled = true;
    try {
      const { canvas: off, missingImage, missingLayers } = await composeCanvas(editor);
      const blob = await new Promise((resolve) => off.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG 생성 실패');
      downloadBlob(blob, `${safeFileName(ctx.projectTitle())}-${editor.width}x${editor.height}.png`);
      if (missingImage || missingLayers) {
        ctx.notify('일부 이미지를 불러오지 못해 빼고 PNG를 만들었습니다. 이미지를 확인해 주세요.', 'error');
      } else {
        ctx.notify('PNG 파일을 내려받았습니다.', 'success');
      }
    } catch {
      ctx.notify('PNG 파일을 만들지 못했습니다. 다시 시도해 주세요.', 'error');
    } finally {
      downloadBtn.disabled = false;
    }
  }

  renderImagePanel();
  refreshAll();
}

function fileButton(forId, input, label, disabled = false) {
  if (disabled) {
    return h('button', { type: 'button', class: 'btn btn-sm', disabled: true }, icon('upload', 'icon-sm'), h('span', null, label));
  }
  return h('label', { htmlFor: forId, class: 'btn btn-sm file-btn', tabIndex: 0, role: 'button',
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } },
  icon('upload', 'icon-sm'), h('span', null, label));
}

/** 슬라이더 + 숫자 입력 한 쌍. onSet(n) 은 사용자가 바꿀 때만 호출된다. */
function numberRange({ id, min, max, step, value, label, onSet }) {
  const v0 = clamp(Math.round(Number(value) || 0), min, max);
  const numIn = h('input', { id, class: 'input num', type: 'number', min, max, step, value: String(v0), inputmode: 'numeric' });
  const range = h('input', { class: 'range', type: 'range', min, max, step, value: String(v0), 'aria-label': label });
  const set = (v, notify = true) => {
    const n = clamp(Math.round(Number(v) || 0), min, max);
    numIn.value = String(n);
    range.value = String(n);
    if (notify) onSet(n);
  };
  numIn.addEventListener('change', () => set(numIn.value));
  range.addEventListener('input', () => set(range.value));
  return { row: h('div', { class: 'range-row' }, range, numIn), set };
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
