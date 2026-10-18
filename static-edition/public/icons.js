// 직접 그린 단순 선 아이콘 (상수 마크업만 사용, 사용자 입력 없음)

const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7 7.5 20h9l1-13"/><path d="M10 11v5M14 11v5"/>',
  download: '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 16V5"/><path d="m7 9.5 5-5 5 5"/><path d="M5 20h14"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17"/>',
  text: '<path d="M5 6.5V5h14v1.5"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5" opacity=".5"/>',
  scenes: '<rect x="3.5" y="4.5" width="7" height="6" rx="1"/><rect x="13.5" y="4.5" width="7" height="6" rx="1"/><rect x="3.5" y="13.5" width="7" height="6" rx="1"/><rect x="13.5" y="13.5" width="7" height="6" rx="1"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  note: '<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M14.5 3.5V7.5h4"/><path d="M9 12h6M9 15.5h6"/>',
  folder: '<path d="M3.5 6.5h6l2 2h9v10h-17z"/>',
  settings: '<circle cx="12" cy="12" r="2.8"/><path d="M10.3 3.5h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L3.9 9l1.7-2.9 2.3.8 1.7-1z"/>',
  logout: '<path d="M10 4.5H5v15h5"/><path d="M14 8l4 4-4 4"/><path d="M18 12H9"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  grip: '<circle cx="9" cy="6.5" r="1"/><circle cx="15" cy="6.5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="17.5" r="1"/><circle cx="15" cy="17.5" r="1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5"/><path d="M12 17.2v.3"/>',
  plug: '<path d="M9 3.5V8M15 3.5V8"/><path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5v4"/><path d="m4 4 16 16" opacity=".55"/>',
  server: '<rect x="4" y="4.5" width="16" height="6" rx="1.5"/><rect x="4" y="13.5" width="16" height="6" rx="1.5"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  scissors: '<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.6 8.5 20 17M8.6 15.5 20 7"/>',
  importIcon: '<path d="M12 3.5v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4.5 15.5v4h15v-4"/>',
  exportIcon: '<path d="M12 14.5v-11"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M4.5 15.5v4h15v-4"/>',
  alignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  alignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  send: '<path d="M4 12h12"/><path d="m12 7 5 5-5 5"/><path d="M20 5v14"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8v.3"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 14-14-0.5 9-6 14-14 14z"/><path d="M5 19 13 11"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  center: '<path d="M12 3.5v17"/><rect x="6" y="8" width="12" height="8" rx="1"/>',
};

const tpl = document.createElement('template');

export function icon(name, cls = '') {
  const body = PATHS[name] || PATHS.info;
  tpl.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  return tpl.content.firstElementChild.cloneNode(true);
}

/** 브랜드 표식: 펼친 노트 위 잎사귀 */
export function brandMark() {
  tpl.innerHTML = '<svg class="brand-mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false"><rect x="3" y="6" width="26" height="20" rx="4" fill="#47614b"/><path d="M16 9v15" stroke="#f5f0e6" stroke-width="1.4" opacity=".6"/><path d="M7 12h6M7 15.5h6M7 19h4" stroke="#f5f0e6" stroke-width="1.4" stroke-linecap="round"/><path d="M19 21c0-5 3-8.5 7-9-.3 5.2-3.2 8.7-7 9z" fill="#e8d9b5"/></svg>';
  return tpl.content.firstElementChild.cloneNode(true);
}
