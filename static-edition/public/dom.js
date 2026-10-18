// 안전한 DOM 생성 도우미. 사용자 입력은 항상 textContent / value 로만 넣는다.

const PROP_KEYS = new Set([
  'value', 'checked', 'disabled', 'hidden', 'selected', 'multiple', 'readOnly',
  'required', 'type', 'name', 'id', 'min', 'max', 'step', 'maxLength', 'tabIndex',
  'placeholder', 'autocomplete', 'accept', 'rows', 'htmlFor', 'draggable',
]);

/**
 * h('button', { class: 'btn', onclick: fn, 'aria-label': '...' }, '텍스트', childNode)
 * 문자열 자식은 텍스트 노드로 추가되므로 HTML 로 해석되지 않는다.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null || val === false) continue;
      if (key === 'class') el.className = val;
      else if (key === 'text') el.textContent = String(val);
      else if (key === 'dataset') Object.assign(el.dataset, val);
      else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2), val);
      else if (PROP_KEYS.has(key)) el[key] = val;
      else el.setAttribute(key, val === true ? '' : String(val));
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function uid(prefix = 'id') {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return prefix + '_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' });

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
}

export function formatTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 파일 이름으로 쓸 수 없는 문자를 제거한다. */
export function safeFileName(name, fallback = '나의-창작실') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function byteLength(str) {
  return new TextEncoder().encode(str).length;
}
