// 스케치 패드. 그림은 브라우저 Canvas 에서만 그리고, 저장할 때만 같은 출처의 자료함 API(uploadBlob)로 보낸다.
// 스케치를 다른 화풍의 완성본으로 바꾸는 AI 변환은 하지 않는다.
import { h, clamp, isHexColor } from './dom.js';
import { icon } from './icons.js';

const MAX_HISTORY = 30;
const MAX_UPLOAD = 10 * 1024 * 1024;
const PEN_SWATCHES = ['#24221e', '#ffffff', '#47614b', '#6e8b70', '#b65c42', '#e2b04a', '#3d5a73', '#8a5a9e'];
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let isOpen = false;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function drawContain(c, img, W, H) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.min(W / iw, H / ih);
  const dw = iw * s, dh = ih * s;
  c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

async function blobToBitmap(blob) {
  if ('createImageBitmap' in window) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * 전체 화면 스케치 패드를 연다.
 * @param {{ width:number, height:number, background?:string, baseImage?:HTMLImageElement|null,
 *           uploadBlob:(blob:Blob, name:string)=>Promise<any|null>, notify?:Function, title?:string }} opts
 * @returns {Promise<any|null>} 자료함에 저장된 자료(asset) 또는 취소 시 null
 */
export function openSketchPad({ width = 1280, height = 720, background = '#ffffff', baseImage = null, uploadBlob, notify = () => {}, title = '스케치 그리기' } = {}) {
  if (isOpen) return Promise.resolve(null);
  isOpen = true;
  return new Promise((resolve) => {
    const W = clamp(Math.round(Number(width) || 1280), 16, 4096);
    const H = clamp(Math.round(Number(height) || 720), 16, 4096);
    const hasBase = !!(baseImage && (baseImage.naturalWidth || baseImage.width));
    const paperColor = isHexColor(background) ? background : '#ffffff';

    const st = {
      tool: 'pen',
      color: '#24221e',
      size: 8,
      opacity: 100,
      paper: background === 'transparent' ? 'transparent' : 'white',
      showGuide: hasBase,
      includeBase: false,
      dirty: false,
      saving: false,
      restoring: false,
    };
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;

    // ---------- 캔버스 ----------
    const paper = h('div', { class: 'sketch-paper', 'aria-hidden': 'true' });
    const guide = h('canvas', { class: 'sketch-guide', width: W, height: H, 'aria-hidden': 'true' });
    const draw = h('canvas', {
      class: 'sketch-draw', width: W, height: H, role: 'img',
      'aria-label': `스케치 캔버스 ${W}×${H}. 마우스, 펜, 손가락으로 그립니다. Ctrl+Z 실행 취소, Ctrl+Y 다시 실행.`,
    });
    const live = h('canvas', { class: 'sketch-live', width: W, height: H, 'aria-hidden': 'true' });
    const dctx = draw.getContext('2d');
    const lctx = live.getContext('2d');
    const board = h('div', { class: 'sketch-board' }, paper, guide, draw, live);
    const stage = h('div', { class: 'sketch-stage' }, board);
    if (hasBase) {
      try { drawContain(guide.getContext('2d'), baseImage, W, H); } catch { /* 이미지가 없으면 무시 */ }
    }

    // ---------- 도구 ----------
    const toolGroup = h('div', { class: 'seg seg-2', role: 'radiogroup', 'aria-label': '도구' });
    [['pen', '펜'], ['eraser', '지우개']].forEach(([val, label]) => {
      const id = `sketch-tool-${val}`;
      const input = h('input', { type: 'radio', name: 'sketch-tool', id, class: 'seg-input', checked: st.tool === val });
      input.addEventListener('change', () => { st.tool = val; updateCursor(); });
      toolGroup.append(input, h('label', { htmlFor: id, class: 'seg-label' }, val === 'pen' ? icon('pen', 'icon-sm') : null, h('span', null, label)));
    });

    const colorIn = h('input', { type: 'color', id: 'sketch-color', class: 'color-input', value: st.color });
    colorIn.addEventListener('input', () => { st.color = colorIn.value; });
    const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': '펜 색 빠른 선택' });
    for (const hex of PEN_SWATCHES) {
      const b = h('button', { type: 'button', class: 'swatch', 'aria-label': `펜 색 ${hex}`, title: hex, onclick: () => {
        st.color = hex; colorIn.value = hex;
        if (st.tool !== 'pen') { st.tool = 'pen'; overlay.querySelector('#sketch-tool-pen').checked = true; updateCursor(); }
      } });
      b.style.setProperty('--sw', hex);
      swatches.append(b);
    }

    const sizeCtl = rangePair('sketch-size', '굵기(px)', 1, 80, st.size, (n) => { st.size = n; });
    const opCtl = rangePair('sketch-opacity', '불투명도(%)', 5, 100, st.opacity, (n) => { st.opacity = n; });

    const undoBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => undo(), 'aria-keyshortcuts': 'Control+Z' }, h('span', null, '실행 취소'));
    const redoBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => redo(), 'aria-keyshortcuts': 'Control+Y' }, h('span', null, '다시 실행'));
    const clearBtn = h('button', { type: 'button', class: 'btn btn-sm btn-quiet danger-text', onclick: clearAll }, icon('trash', 'icon-sm'), h('span', null, '전체 지우기'));

    const paperGroup = h('div', { class: 'seg seg-2', role: 'radiogroup', 'aria-label': '배경' });
    [['white', '흰 종이'], ['transparent', '투명']].forEach(([val, label]) => {
      const id = `sketch-paper-${val}`;
      const input = h('input', { type: 'radio', name: 'sketch-paper', id, class: 'seg-input', checked: st.paper === val });
      input.addEventListener('change', () => { st.paper = val; updatePaper(); });
      paperGroup.append(input, h('label', { htmlFor: id, class: 'seg-label' }, h('span', null, label)));
    });

    let guideField = null;
    if (hasBase) {
      const showIn = h('input', { type: 'checkbox', id: 'sketch-guide', checked: st.showGuide });
      showIn.addEventListener('change', () => { st.showGuide = showIn.checked; guide.hidden = !st.showGuide; });
      const incIn = h('input', { type: 'checkbox', id: 'sketch-include', checked: st.includeBase });
      incIn.addEventListener('change', () => { st.includeBase = incIn.checked; });
      guideField = h('div', { class: 'field' },
        h('span', { class: 'label-like' }, '선택 이미지 위에 따라 그리기'),
        h('label', { class: 'check', htmlFor: 'sketch-guide' }, showIn, h('span', null, '밑그림 흐리게 보기')),
        h('label', { class: 'check', htmlFor: 'sketch-include' }, incIn, h('span', null, '저장할 때 배경 이미지 포함')),
      );
    }

    const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, icon('save', 'icon-sm'), h('span', null, '자료함에 저장'));
    const cancelBtn = h('button', { type: 'button', class: 'btn', onclick: tryClose }, h('span', null, '취소'));
    const status = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });

    const tools = h('div', { class: 'sketch-tools' },
      h('div', { class: 'field' }, h('span', { class: 'label-like' }, '도구'), toolGroup),
      h('div', { class: 'field color-field' }, h('label', { htmlFor: 'sketch-color' }, '색'), h('div', { class: 'color-row' }, colorIn, swatches)),
      h('div', { class: 'field' }, h('label', { htmlFor: 'sketch-size' }, '굵기(px)'), sizeCtl.row),
      h('div', { class: 'field' }, h('label', { htmlFor: 'sketch-opacity' }, '불투명도(%) · 펜에만 적용'), opCtl.row),
      h('div', { class: 'btn-row' }, undoBtn, redoBtn, clearBtn),
      h('div', { class: 'field' }, h('span', { class: 'label-like' }, '배경'), paperGroup),
      guideField,
      h('p', { class: 'sketch-note' }, icon('info', 'icon-sm'),
        h('span', null, '스케치를 원하는 화풍의 완성본으로 바꾸는 기능은 AI 연결 후 제공됩니다. 지금은 스케치 저장·합성만 가능합니다.')),
      h('div', { class: 'sketch-actions' }, cancelBtn, saveBtn),
      status,
    );

    // ---------- 닫기 확인 ----------
    const keepBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => hideConfirm() }, '계속 그리기');
    const discardBtn = h('button', { type: 'button', class: 'btn btn-danger', onclick: () => finish(null) }, '버리고 닫기');
    const confirmBox = h('div', { class: 'sketch-confirm', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sketch-confirm-msg', hidden: true },
      h('p', { id: 'sketch-confirm-msg' }, '저장하지 않은 스케치가 있습니다. 버리고 닫을까요?'),
      h('div', { class: 'btn-row' }, keepBtn, discardBtn),
    );

    const titleId = 'sketch-title';
    const overlay = h('div', { class: 'sketch-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'sketch-shell' },
        h('header', { class: 'sketch-head' },
          h('div', null,
            h('h2', { id: titleId, class: 'sketch-title' }, title),
            h('p', { class: 'muted small-text' }, `${W}×${H}px · 이 컴퓨터의 브라우저에서만 그립니다.`),
          ),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '스케치 닫기', onclick: tryClose }, icon('close')),
        ),
        h('div', { class: 'sketch-body' }, stage, tools),
        confirmBox,
      ),
    );

    // ---------- 크기 맞춤 ----------
    function fit() {
      const cs = getComputedStyle(stage);
      const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (aw <= 0 || ah <= 0) return;
      const s = Math.min(aw / W, ah / H);
      board.style.width = `${Math.floor(W * s)}px`;
      board.style.height = `${Math.floor(H * s)}px`;
    }
    const ro = 'ResizeObserver' in window ? new ResizeObserver(fit) : null;

    function updatePaper() {
      paper.classList.toggle('is-transparent', st.paper === 'transparent');
      paper.style.background = st.paper === 'transparent' ? '' : paperColor;
    }
    function updateCursor() {
      draw.classList.toggle('is-eraser', st.tool === 'eraser');
    }

    // ---------- 실행 취소 기록 (PNG Blob 으로 보관해 메모리를 아낀다) ----------
    const history = [Promise.resolve(null)];
    let hIndex = 0;
    function snapshot() {
      return new Promise((res) => draw.toBlob((b) => res(b), 'image/png'));
    }
    function pushHistory() {
      history.splice(hIndex + 1);
      history.push(snapshot());
      while (history.length > MAX_HISTORY + 1) history.shift();
      hIndex = history.length - 1;
      updateButtons();
    }
    async function restore(i) {
      st.restoring = true;
      updateButtons();
      try {
        const blob = await history[i];
        dctx.clearRect(0, 0, W, H);
        if (blob) {
          const bmp = await blobToBitmap(blob);
          dctx.drawImage(bmp, 0, 0);
          if (typeof bmp.close === 'function') bmp.close();
        }
      } catch {
        notify('이전 상태를 불러오지 못했습니다.', 'error');
      } finally {
        st.restoring = false;
        updateButtons();
      }
    }
    async function undo() {
      if (hIndex <= 0 || st.restoring || stroke) return;
      hIndex -= 1;
      st.dirty = true;
      await restore(hIndex);
      status.textContent = '실행 취소했습니다.';
    }
    async function redo() {
      if (hIndex >= history.length - 1 || st.restoring || stroke) return;
      hIndex += 1;
      st.dirty = true;
      await restore(hIndex);
      status.textContent = '다시 실행했습니다.';
    }
    function clearAll() {
      if (st.restoring || stroke) return;
      dctx.clearRect(0, 0, W, H);
      st.dirty = true;
      pushHistory();
      status.textContent = '전체를 지웠습니다. 실행 취소로 되돌릴 수 있습니다.';
    }
    function updateButtons() {
      undoBtn.disabled = hIndex <= 0 || st.restoring;
      redoBtn.disabled = hIndex >= history.length - 1 || st.restoring;
      saveBtn.disabled = st.saving || st.restoring;
      clearBtn.disabled = st.restoring;
    }

    // ---------- 그리기 ----------
    let stroke = null;
    function toCanvas(e) {
      const r = draw.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
    }
    function prep(c, eraser) {
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = st.size;
      c.globalAlpha = 1;
      c.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
      c.strokeStyle = eraser ? '#000' : st.color;
      c.fillStyle = eraser ? '#000' : st.color;
    }
    function segment() {
      const { pts, c } = stroke;
      const n = pts.length;
      c.beginPath();
      if (n === 2) {
        const m = mid(pts[0], pts[1]);
        c.moveTo(pts[0].x, pts[0].y);
        c.lineTo(m.x, m.y);
      } else {
        const a = pts[n - 3], b = pts[n - 2], d = pts[n - 1];
        const m1 = mid(a, b), m2 = mid(b, d);
        c.moveTo(m1.x, m1.y);
        c.quadraticCurveTo(b.x, b.y, m2.x, m2.y);
      }
      c.stroke();
    }
    draw.addEventListener('pointerdown', (e) => {
      if (st.restoring || st.saving || stroke) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { draw.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      const eraser = st.tool === 'eraser';
      const c = eraser ? dctx : lctx;
      prep(c, eraser);
      live.style.opacity = String(st.opacity / 100);
      const p = toCanvas(e);
      stroke = { pid: e.pointerId, pts: [p], eraser, c };
      c.beginPath();
      c.arc(p.x, p.y, st.size / 2, 0, Math.PI * 2);
      c.fill();
    });
    draw.addEventListener('pointermove', (e) => {
      if (!stroke || e.pointerId !== stroke.pid) return;
      e.preventDefault();
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ev of list.length ? list : [e]) {
        const p = toCanvas(ev);
        const last = stroke.pts[stroke.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.75) continue;
        stroke.pts.push(p);
        if (stroke.pts.length > 3) stroke.pts.shift();
        segment();
      }
    });
    const endStroke = (e) => {
      if (!stroke || (e && e.pointerId !== stroke.pid)) return;
      const { pts, c, eraser } = stroke;
      if (pts.length >= 2) {
        const a = pts[pts.length - 2], b = pts[pts.length - 1];
        const m = mid(a, b);
        c.beginPath();
        c.moveTo(m.x, m.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
      if (!eraser) {
        dctx.save();
        dctx.globalCompositeOperation = 'source-over';
        dctx.globalAlpha = st.opacity / 100;
        dctx.drawImage(live, 0, 0);
        dctx.restore();
        lctx.clearRect(0, 0, W, H);
      } else {
        dctx.globalCompositeOperation = 'source-over';
      }
      stroke = null;
      st.dirty = true;
      pushHistory();
    };
    draw.addEventListener('pointerup', endStroke);
    draw.addEventListener('pointercancel', endStroke);

    // ---------- 저장 / 닫기 ----------
    function compose() {
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const c = out.getContext('2d');
      if (st.paper === 'white') { c.fillStyle = paperColor; c.fillRect(0, 0, W, H); }
      if (hasBase && st.includeBase) drawContain(c, baseImage, W, H);
      c.drawImage(draw, 0, 0);
      return out;
    }

    async function save() {
      if (st.saving || st.restoring || stroke) return;
      if (typeof uploadBlob !== 'function') { notify('스케치를 저장할 수 없습니다.', 'error'); return; }
      st.saving = true;
      updateButtons();
      saveBtn.lastChild.textContent = '저장 중…';
      try {
        const blob = await new Promise((res) => compose().toBlob(res, 'image/png'));
        if (!blob) throw new Error('PNG 생성 실패');
        if (blob.size > MAX_UPLOAD) {
          notify('스케치 PNG가 10MB를 넘어 저장할 수 없습니다. 배경을 투명으로 바꾸거나 그림을 줄여 주세요.', 'error');
          return;
        }
        const asset = await uploadBlob(blob, `스케치-${stamp()}.png`);
        if (asset) { finish(asset); return; }
        notify('자료함에 저장하지 못했습니다. 그림은 그대로 남아 있습니다.', 'error');
      } catch {
        notify('스케치를 저장하지 못했습니다. 그림은 그대로 남아 있습니다.', 'error');
      } finally {
        if (overlay.isConnected) {
          st.saving = false;
          saveBtn.lastChild.textContent = '자료함에 저장';
          updateButtons();
        }
      }
    }

    function tryClose() {
      if (st.saving) return;
      if (st.dirty) { showConfirm(); return; }
      finish(null);
    }
    function showConfirm() {
      confirmBox.hidden = false;
      keepBtn.focus();
    }
    function hideConfirm() {
      confirmBox.hidden = true;
      saveBtn.focus();
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!confirmBox.hidden) hideConfirm();
        else tryClose();
        return;
      }
      if (e.key === 'Tab') {
        const scope = confirmBox.hidden ? overlay : confirmBox;
        const items = Array.from(scope.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); }
        else if (k === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
        else if (k === 's') { e.preventDefault(); e.stopPropagation(); }
      }
    }

    function finish(result) {
      if (!overlay.isConnected) return;
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', fit);
      if (ro) ro.disconnect();
      overlay.remove();
      document.body.style.overflow = prevOverflow;
      isOpen = false;
      if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) prevFocus.focus();
      resolve(result);
    }

    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', fit);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    guide.hidden = !st.showGuide;
    updatePaper();
    updateCursor();
    updateButtons();
    if (ro) ro.observe(stage);
    requestAnimationFrame(fit);
    overlay.querySelector('#sketch-tool-pen')?.focus();
  });
}

function rangePair(id, label, min, max, value, onSet) {
  const numIn = h('input', { id, class: 'input num', type: 'number', min, max, step: 1, value: String(value), inputmode: 'numeric' });
  const range = h('input', { class: 'range', type: 'range', min, max, step: 1, value: String(value), 'aria-label': `${label} 조절` });
  const set = (v) => {
    const n = clamp(Math.round(Number(v) || min), min, max);
    numIn.value = String(n);
    range.value = String(n);
    onSet(n);
  };
  numIn.addEventListener('change', () => set(numIn.value));
  range.addEventListener('input', () => set(range.value));
  return { row: h('div', { class: 'range-row' }, range, numIn) };
}
