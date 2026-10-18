// 나의 창작실 - 프런트엔드 진입점 (외부 의존성 없음)
import { h, clear, uid, formatBytes, formatDate, formatTime, downloadBlob, safeFileName, deepClone, byteLength, isHexColor } from './dom.js';
import { icon, brandMark } from './icons.js';
import { studioApi, assetUrl } from './api.js';
import { renderStory, MAX_SCRIPT, MAX_SCENES } from './story.js';
import { renderEditor, makeLayer, forgetImage, RATIOS, MAX_LAYERS, MAX_IMAGE_LAYERS } from './canvas-editor.js';
import { renderPromptLab } from './promptlab.js';
import { openSketchPad } from './sketch.js';

const TYPE_LABELS = { travel: '여행', story: '이야기', image: '이미지', other: '기타' };
const TYPES = Object.keys(TYPE_LABELS);
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_IMPORT = 64 * 1024 * 1024;
const MAX_STATE_BYTES = 256 * 1024;
const MAX_NOTES = 20000;
const DEFAULT_STATE = {
  story: { script: '', scenes: [], characters: [] },
  editor: { width: 1280, height: 720, background: '#e8e3d8', baseAssetId: null, fit: 'cover', textLayers: [], imageLayers: [] },
  promptLab: { picks: {}, subject: '', negative: '', ratio: '16:9', depth: 'auto', seed: null, characterIds: [] },
  notes: '',
};
const MAX_CHARACTERS = 12;
const PROMPT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'];
const PROMPT_DEPTHS = ['auto', 'sharp', 'blur'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TABS = [
  { id: 'story', label: '대본·장면', icon: 'pen' },
  { id: 'image', label: '이미지·썸네일', icon: 'image' },
  { id: 'prompt', label: '프롬프트·AI', icon: 'leaf' },
  { id: 'assets', label: '자료', icon: 'folder' },
  { id: 'info', label: '정보·메모', icon: 'note' },
];

const S = {
  status: null,
  user: null,
  projects: [],
  query: '',
  typeFilter: 'all',
  cur: null, // { project, draft:{title,description,type,state}, dirty, rev, saving, savedAt, error, conflict }
  assets: [],
  tab: 'story',
  loadingProject: false,
  reauthOpen: false,
};

const appRoot = document.getElementById('app');
const toastRoot = document.getElementById('toasts');
const UI = {}; // 작업실 고정 요소 참조

// ======================================================================
// 공통: 알림, 대화상자
// ======================================================================
function notify(message, kind = 'info') {
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info', 'icon-sm'),
    h('p', null, String(message)),
    h('button', { type: 'button', class: 'icon-btn toast-close', 'aria-label': '알림 닫기', onclick: () => el.remove() }, icon('close', 'icon-sm')),
  );
  toastRoot.append(el);
  while (toastRoot.children.length > 4) toastRoot.firstElementChild.remove();
  setTimeout(() => el.remove(), kind === 'error' ? 9000 : 4500);
}

/**
 * 접근성 있는 모달. actions 는 DOM 순서상 첫 번째가 기본(Enter) 동작이다.
 * onAction 이 false 를 반환하면 닫지 않는다.
 */
function openDialog({ title, message, content, actions, onAction, initialFocus, className = '', hideCancel = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const titleId = uid('dlg');
    const errorBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const btns = actions.map((a) => h('button', {
      type: 'submit', value: a.value, class: `btn ${a.variant === 'danger' ? 'btn-danger' : a.variant === 'primary' ? 'btn-primary' : a.variant === 'quiet' ? 'btn-quiet' : ''}`,
    }, a.label));
    const cancelBtn = h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => done(null) }, '취소');
    const form = h('form', { class: 'dialog-form', novalidate: true },
      h('div', { class: 'dialog-head' },
        h('h2', { id: titleId, class: 'dialog-title' }, title),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => done(null) }, icon('close')),
      ),
      message ? h('p', { class: 'dialog-msg' }, message) : null,
      content || null,
      errorBox,
      h('div', { class: `dialog-actions${actions.length > 2 ? ' is-column' : ''}` }, ...btns, hideCancel ? null : cancelBtn),
    );
    const dlg = h('dialog', { class: `dialog ${className}`, 'aria-labelledby': titleId }, form);
    let finished = false;
    function done(value) {
      if (finished) return;
      finished = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus();
      resolve(value);
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = (e.submitter && e.submitter.value) || actions[0].value;
      if (!onAction) return done(value);
      errorBox.hidden = true;
      btns.forEach((b) => { b.disabled = true; });
      try {
        const r = await onAction(value, form, (msg) => { errorBox.textContent = msg; errorBox.hidden = false; });
        if (r === false) return;
        done(r === undefined ? value : r);
      } finally {
        btns.forEach((b) => { b.disabled = false; });
      }
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(dlg);
    dlg.showModal();
    const focusEl = initialFocus ? form.querySelector(initialFocus) : btns[0];
    (focusEl || btns[0]).focus();
  });
}

function confirmDialog({ title, message, okLabel = '확인', danger = false }) {
  return openDialog({ title, message, actions: [{ value: 'ok', label: okLabel, variant: danger ? 'danger' : 'primary' }] })
    .then((v) => v === 'ok');
}

function choose({ title, message, choices }) {
  return openDialog({ title, message, actions: choices.map((c, i) => ({ ...c, variant: c.variant || (i === 0 ? 'primary' : '') })) });
}

function aiBlocked(feature) {
  const configured = !!(S.status && S.status.ai && S.status.ai.configured);
  openDialog({
    title: 'AI 미연결',
    content: h('div', { class: 'stack' },
      h('p', null, `"${feature}" 기능은 아직 연결되지 않았습니다.`),
      h('p', null, '이 버튼은 요청을 보내지 않았고, 생성 결과·유료 호출·결제도 발생하지 않았습니다.'),
      h('p', { class: 'muted' }, configured
        ? '서버에서 AI 설정이 감지되었지만, 이 화면에는 아직 생성 기능이 구현되어 있지 않습니다.'
        : 'AI 제공자·키·모델을 확인하고 별도로 승인한 뒤에 연결할 예정입니다. 그동안 수동 편집·로컬 분할·PNG 출력은 그대로 쓸 수 있습니다.'),
    ),
    actions: [{ value: 'ok', label: '알겠습니다', variant: 'primary' }],
    hideCancel: true,
  });
}

function handleError(err, prefix = '') {
  if (err && err.status === 401 && S.user) {
    reauth();
    return;
  }
  notify(`${prefix}${err && err.message ? err.message : '알 수 없는 오류가 발생했습니다.'}`, 'error');
}

// ======================================================================
// 상태 정규화 / 검증
// ======================================================================
const str = (v, max = 100000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
/** #rgb → #rrggbb (색 선택 입력은 6자리만 받음) */
function hex6(v, fallback) {
  if (typeof v === 'string' && /^#[0-9a-fA-F]{3}$/.test(v)) return ('#' + v.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return isHexColor(v) ? v.toLowerCase() : fallback;
}
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeState(raw) {
  const base = deepClone(DEFAULT_STATE);
  const src = raw && typeof raw === 'object' ? deepClone(raw) : {};
  const out = { ...base, ...src };
  const story = src.story && typeof src.story === 'object' ? src.story : {};
  out.story = { ...base.story, ...story };
  out.story.script = str(out.story.script);
  const assetRef = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
  const seenChar = new Set();
  out.story.characters = (Array.isArray(story.characters) ? story.characters : [])
    .filter((c) => c && typeof c === 'object')
    .slice(0, MAX_CHARACTERS)
    .map((c) => {
      const id = typeof c.id === 'string' && ID_RE.test(c.id) && !seenChar.has(c.id) ? c.id : uid('char');
      seenChar.add(id);
      return {
        id,
        name: str(c.name, 60).replace(/[\r\n\t]+/g, ' '),
        look: str(c.look, 1000),
        assetId: assetRef(c.assetId),
      };
    });
  const charIds = (list) => [...new Set((Array.isArray(list) ? list : []).filter((id) => seenChar.has(id)))];
  out.story.scenes = (Array.isArray(story.scenes) ? story.scenes : [])
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => ({
      ...s,
      id: typeof s.id === 'string' && ID_RE.test(s.id) ? s.id : uid('scene'),
      title: str(s.title) || `장면 ${i + 1}`,
      narration: str(s.narration),
      prompt: str(s.prompt),
      duration: Math.max(0, num(s.duration, 0)),
      imagePrompt: str(s.imagePrompt, 4000),
      assetId: assetRef(s.assetId),
      characterIds: charIds(s.characterIds),
    }));
  const ed = src.editor && typeof src.editor === 'object' ? src.editor : {};
  out.editor = { ...base.editor, ...ed };
  const ratio = RATIOS.find((r) => r.w === Number(ed.width) && r.h === Number(ed.height));
  out.editor.width = ratio ? ratio.w : 1280;
  out.editor.height = ratio ? ratio.h : 720;
  out.editor.background = hex6(ed.background, base.editor.background);
  out.editor.fit = ed.fit === 'contain' ? 'contain' : 'cover';
  out.editor.baseAssetId = typeof ed.baseAssetId === 'string' && ed.baseAssetId ? ed.baseAssetId : null;
  out.editor.textLayers = (Array.isArray(ed.textLayers) ? ed.textLayers : [])
    .filter((l) => l && typeof l === 'object')
    .map((l) => ({
      ...l,
      id: typeof l.id === 'string' && ID_RE.test(l.id) ? l.id : uid('layer'),
      text: str(l.text, 500),
      x: num(l.x, 100),
      y: num(l.y, 100),
      fontSize: Math.min(400, Math.max(8, num(l.fontSize, 64))),
      color: hex6(l.color, '#24221e'),
      fontFamily: typeof l.fontFamily === 'string' && /^[A-Za-z0-9 ,'"_-]{1,80}$/.test(l.fontFamily) ? l.fontFamily : 'sans-serif',
      align: ['left', 'center', 'right'].includes(l.align) ? l.align : 'left',
      shadow: !!l.shadow,
      strokeColor: hex6(l.strokeColor, '#000000'),
      strokeWidth: Math.min(60, Math.max(0, num(l.strokeWidth, 0))),
    }));
  out.editor.imageLayers = (Array.isArray(ed.imageLayers) ? ed.imageLayers : [])
    .filter((l) => l && typeof l === 'object' && assetRef(l.assetId))
    .slice(0, MAX_IMAGE_LAYERS)
    .map((l) => ({
      id: typeof l.id === 'string' && ID_RE.test(l.id) ? l.id : uid('img'),
      assetId: l.assetId,
      x: num(l.x, 0),
      y: num(l.y, 0),
      w: Math.max(8, num(l.w, 400)),
      h: Math.max(8, num(l.h, 400)),
      opacity: Math.min(1, Math.max(0, num(l.opacity, 1))),
    }));
  const pl = src.promptLab && typeof src.promptLab === 'object' ? src.promptLab : {};
  const picks = {};
  if (pl.picks && typeof pl.picks === 'object' && !Array.isArray(pl.picks)) {
    for (const [k, v] of Object.entries(pl.picks).slice(0, 24)) {
      if (!ID_RE.test(k) || !Array.isArray(v)) continue;
      picks[k] = [...new Set(v.filter((x) => typeof x === 'string' && ID_RE.test(x)))].slice(0, 16);
    }
  }
  const seed = Number(pl.seed);
  out.promptLab = {
    picks,
    subject: str(pl.subject, 4000),
    negative: str(pl.negative, 2000),
    ratio: PROMPT_RATIOS.includes(pl.ratio) ? pl.ratio : '16:9',
    depth: PROMPT_DEPTHS.includes(pl.depth) ? pl.depth : 'auto',
    seed: pl.seed !== null && pl.seed !== undefined && Number.isInteger(seed) && seed >= 0 && seed <= 2147483647 ? seed : null,
    characterIds: charIds(pl.characterIds),
  };
  out.notes = str(src.notes);
  return out;
}

function validateDraft(d) {
  const title = d.title.trim();
  if (!title) return '작업 제목을 입력해 주세요.';
  if (title.length > 120) return '작업 제목은 120자 이하로 입력해 주세요.';
  if (d.description.length > 2000) return '설명은 2,000자 이하로 입력해 주세요.';
  if (d.state.story.script.length > MAX_SCRIPT) return `대본은 ${MAX_SCRIPT.toLocaleString('ko-KR')}자 이하만 저장할 수 있습니다.`;
  if (d.state.story.scenes.length > MAX_SCENES) return `장면은 최대 ${MAX_SCENES}개까지 저장할 수 있습니다.`;
  if (d.state.editor.textLayers.length > MAX_LAYERS) return `문구 레이어는 최대 ${MAX_LAYERS}개까지 저장할 수 있습니다.`;
  if (d.state.editor.imageLayers.length > MAX_IMAGE_LAYERS) return `이미지 레이어는 최대 ${MAX_IMAGE_LAYERS}개까지 저장할 수 있습니다.`;
  if (d.state.story.characters.length > MAX_CHARACTERS) return `등장인물은 최대 ${MAX_CHARACTERS}명까지 저장할 수 있습니다.`;
  const bytes = byteLength(JSON.stringify(d.state));
  if (bytes > MAX_STATE_BYTES) return `작업 데이터가 너무 큽니다 (${formatBytes(bytes)} / 최대 256 KB). 대본이나 메모를 줄여 주세요.`;
  return '';
}

function makeCur(project) {
  return {
    project,
    draft: {
      title: str(project.title, 120),
      description: str(project.description, 2000),
      type: TYPES.includes(project.type) ? project.type : 'other',
      state: normalizeState(project.state),
    },
    dirty: false,
    rev: 0,
    saving: false,
    savedAt: null,
    error: '',
    conflict: false,
  };
}

// ======================================================================
// 부팅 / 인증
// ======================================================================
async function boot() {
  clear(appRoot);
  appRoot.append(h('div', { class: 'boot' }, brandMark(), h('p', null, '작업실을 여는 중…')));
  try {
    S.status = await studioApi.status();
  } catch (err) {
    renderFatal(err);
    return;
  }
  if (S.status.setupRequired) renderAuth('setup');
  else if (!S.status.authenticated) renderAuth('login');
  else {
    S.user = S.status.user;
    enterWorkspace();
  }
}

function renderFatal(err) {
  clear(appRoot);
  appRoot.append(h('main', { class: 'auth-wrap' },
    h('section', { class: 'auth-card' },
      h('div', { class: 'auth-brand' }, brandMark(), h('span', null, '나의 창작실')),
      h('h1', { class: 'auth-title' }, '서버에 연결하지 못했습니다'),
      h('p', { class: 'form-error', role: 'alert' }, err && err.message ? err.message : '알 수 없는 오류'),
      h('p', { class: 'muted' }, '이 앱은 이 컴퓨터에서 실행하는 로컬 서버와 함께 동작합니다. 서버를 다시 켠 뒤 시도해 주세요.'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: boot }, '다시 시도'),
    ),
  ));
}

function field({ id, label, type = 'text', value = '', autocomplete, maxLength, hint, required = true, minLength }) {
  const input = h('input', { id, name: id, class: 'input', type, value, autocomplete, maxLength, required, minlength: minLength });
  return h('div', { class: 'field' },
    h('label', { htmlFor: id }, label),
    input,
    hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
  );
}

function renderAuth(mode) {
  clear(appRoot);
  const isSetup = mode === 'setup';
  const errorBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, isSetup ? '내 작업실 만들기' : '들어가기');
  const showPw = h('input', { type: 'checkbox', id: 'show-pw' });

  const fields = isSetup
    ? [
      field({ id: 'setup-name', label: '이름 (작업실에 표시)', autocomplete: 'name', maxLength: 60 }),
      field({ id: 'setup-email', label: '이메일 (로그인 아이디)', type: 'email', autocomplete: 'username', maxLength: 200 }),
      field({ id: 'setup-pw', label: '비밀번호', type: 'password', autocomplete: 'new-password', maxLength: 200, minLength: 12, hint: '12자 이상. 비밀번호 찾기 기능이 아직 없으니 직접 안전하게 보관해 주세요.' }),
      field({ id: 'setup-pw2', label: '비밀번호 확인', type: 'password', autocomplete: 'new-password', maxLength: 200 }),
    ]
    : [
      field({ id: 'login-email', label: '이메일', type: 'email', autocomplete: 'username', maxLength: 200 }),
      field({ id: 'login-pw', label: '비밀번호', type: 'password', autocomplete: 'current-password', maxLength: 200 }),
    ];

  const form = h('form', { class: 'auth-form', novalidate: true },
    ...fields,
    h('label', { class: 'check', htmlFor: 'show-pw' }, showPw, h('span', null, '비밀번호 보기')),
    errorBox,
    submit,
  );
  showPw.addEventListener('change', () => {
    form.querySelectorAll('input[type="password"], input[data-pw]').forEach((el) => {
      el.dataset.pw = '1';
      el.type = showPw.checked ? 'text' : 'password';
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const fail = (msg, focusId) => {
      errorBox.textContent = msg;
      errorBox.hidden = false;
      if (focusId) document.getElementById(focusId)?.focus();
    };
    const val = (id) => document.getElementById(id).value;
    let call;
    if (isSetup) {
      const name = val('setup-name').trim();
      const email = val('setup-email').trim();
      const pw = val('setup-pw');
      if (!name) return fail('이름을 입력해 주세요.', 'setup-name');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('올바른 이메일 주소를 입력해 주세요.', 'setup-email');
      if (pw.length < 12) return fail('비밀번호는 12자 이상이어야 합니다.', 'setup-pw');
      if (pw !== val('setup-pw2')) return fail('비밀번호 확인이 일치하지 않습니다.', 'setup-pw2');
      call = () => studioApi.setup(name, email, pw);
    } else {
      const email = val('login-email').trim();
      const pw = val('login-pw');
      if (!email || !pw) return fail('이메일과 비밀번호를 입력해 주세요.', email ? 'login-pw' : 'login-email');
      call = () => studioApi.login(email, pw);
    }
    submit.disabled = true;
    submit.textContent = isSetup ? '만드는 중…' : '확인 중…';
    try {
      const res = await call();
      S.user = res.user || null;
      try { S.status = await studioApi.status(); } catch { /* 상태 갱신 실패는 치명적이지 않음 */ }
      if (S.status && S.status.user) S.user = S.status.user;
      enterWorkspace();
    } catch (err) {
      if (isSetup && err.status === 409) {
        fail('이미 소유자 계정이 만들어져 있습니다. 로그인 화면으로 이동합니다.');
        setTimeout(() => renderAuth('login'), 1400);
      } else {
        fail(err.message || '처리하지 못했습니다.');
      }
      submit.disabled = false;
      submit.textContent = isSetup ? '내 작업실 만들기' : '들어가기';
    }
  });

  appRoot.append(h('main', { class: 'auth-wrap' },
    h('section', { class: 'auth-card', 'aria-labelledby': 'auth-title' },
      h('div', { class: 'auth-brand' }, brandMark(), h('span', null, '나의 창작실')),
      h('h1', { id: 'auth-title', class: 'auth-title' }, isSetup ? '처음 오셨네요. 작업실 주인을 정해 주세요' : '다시 오신 걸 환영해요'),
      h('p', { class: 'muted' }, isSetup
        ? '이 서버에는 소유자 계정 하나만 만들 수 있고, 이후 새 가입은 막힙니다. 미리 정해진 계정이나 비밀번호는 없습니다.'
        : '나만 쓰는 비공개 작업실입니다. 소유자 계정으로 로그인하세요.'),
      form,
      h('p', { class: 'auth-foot' }, icon('server', 'icon-sm'), '로컬 서버 시제품 · 외부 배포와 여러 기기 동기화는 아직 켜져 있지 않습니다.'),
    ),
  ));
  document.getElementById(isSetup ? 'setup-name' : 'login-email')?.focus();
}

async function reauth() {
  if (S.reauthOpen) return;
  S.reauthOpen = true;
  const email = h('input', { id: 'reauth-email', class: 'input', type: 'email', autocomplete: 'username', value: S.user ? S.user.email || '' : '' });
  const pw = h('input', { id: 'reauth-pw', class: 'input', type: 'password', autocomplete: 'current-password' });
  const ok = await openDialog({
    title: '다시 로그인해 주세요',
    message: '로그인 세션이 끝났습니다. 화면의 작업 내용은 그대로 유지됩니다. 로그인 후 저장을 다시 눌러 주세요.',
    content: h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', { htmlFor: 'reauth-email' }, '이메일'), email),
      h('div', { class: 'field' }, h('label', { htmlFor: 'reauth-pw' }, '비밀번호'), pw),
    ),
    initialFocus: '#reauth-pw',
    actions: [{ value: 'login', label: '로그인', variant: 'primary' }],
    onAction: async (_v, _f, showError) => {
      try {
        const res = await studioApi.login(email.value.trim(), pw.value);
        S.user = res.user || S.user;
        return 'ok';
      } catch (err) {
        showError(err.message);
        return false;
      }
    },
  });
  S.reauthOpen = false;
  if (ok === 'ok') {
    notify('다시 로그인했습니다. 작업 내용은 그대로입니다.', 'success');
    renderTopbarUser();
  } else {
    notify('로그인하지 않으면 저장할 수 없습니다. 변경 내용은 이 창에만 남아 있습니다.', 'error');
  }
}

// ======================================================================
// 작업실 레이아웃
// ======================================================================
function enterWorkspace() {
  clear(appRoot);
  S.cur = null;
  S.assets = [];

  UI.menuBtn = h('button', { type: 'button', class: 'icon-btn menu-btn', 'aria-label': '작업 목록 열기', 'aria-expanded': 'false', 'aria-controls': 'library', onclick: toggleDrawer }, icon('menu'));
  UI.saveStatus = h('button', { type: 'button', class: 'save-status', hidden: true, onclick: onStatusClick, onmousedown: keepFocus, 'aria-live': 'polite' });
  UI.userBtn = h('button', { type: 'button', class: 'user-chip', onclick: openSettings, 'aria-label': '설정과 계정' });
  const topbar = h('header', { class: 'topbar' },
    UI.menuBtn,
    h('div', { class: 'brand' }, brandMark(), h('span', { class: 'brand-name' }, '나의 창작실')),
    h('div', { class: 'topbar-spacer' }),
    UI.saveStatus,
    h('span', { class: 'chip chip-off', title: 'AI 제공자가 연결되지 않았습니다' }, icon('plug', 'icon-sm'), h('span', { class: 'chip-text' }, 'AI 미연결')),
    h('button', { type: 'button', class: 'icon-btn topbar-settings', 'aria-label': '설정', onclick: openSettings }, icon('settings')),
    UI.userBtn,
  );

  // 사이드바
  UI.search = h('input', { id: 'project-search', class: 'input search-input', type: 'search', placeholder: '제목·설명 검색', autocomplete: 'off' });
  UI.search.addEventListener('input', () => { S.query = UI.search.value; renderProjectList(); });
  UI.filters = h('div', { class: 'filter-row', role: 'group', 'aria-label': '종류로 거르기' });
  UI.list = h('ul', { class: 'project-list', 'aria-label': '작업 목록' });
  const importInput = h('input', { type: 'file', id: 'import-file', class: 'sr-only', accept: '.json,application/json' });
  importInput.addEventListener('change', () => {
    const f = importInput.files && importInput.files[0];
    importInput.value = '';
    if (f) importBackup(f);
  });
  UI.library = h('aside', { id: 'library', class: 'library', 'aria-label': '작업 목록' },
    h('div', { class: 'lib-head' },
      h('h2', { class: 'lib-title' }, '작업 목록'),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: newProjectDialog }, icon('plus', 'icon-sm'), h('span', null, '새 작업')),
    ),
    h('div', { class: 'search-box' },
      h('label', { class: 'sr-only', htmlFor: 'project-search' }, '작업 검색'),
      icon('search', 'icon-sm search-icon'),
      UI.search,
    ),
    UI.filters,
    UI.list,
    h('div', { class: 'lib-foot' },
      importInput,
      h('button', { type: 'button', class: 'btn btn-quiet btn-sm btn-block', onclick: () => importInput.click() }, icon('importIcon', 'icon-sm'), h('span', null, '백업 파일 가져오기')),
      h('p', { class: 'lib-note' }, icon('server', 'icon-sm'), h('span', null, '이 컴퓨터의 로컬 서버에 저장 · 다른 기기 동기화는 아직 없음')),
    ),
  );
  UI.scrim = h('div', { class: 'scrim', onclick: closeDrawer });
  UI.main = h('main', { id: 'main', class: 'main', tabIndex: -1 });

  appRoot.append(
    h('a', { class: 'skip-link', href: '#main' }, '본문으로 건너뛰기'),
    h('div', { class: 'shell' }, topbar, h('div', { class: 'body' }, UI.library, UI.scrim, UI.main)),
  );
  renderTopbarUser();
  renderFilters();
  renderMain();
  loadProjects().then(() => {
    const m = /^#\/p\/(.+)$/.exec(location.hash);
    if (m) openProject(decodeURIComponent(m[1]), { fromHash: true });
  });
}

function renderTopbarUser() {
  if (!UI.userBtn) return;
  clear(UI.userBtn);
  const name = (S.user && S.user.name) || '나';
  UI.userBtn.append(h('span', { class: 'avatar', 'aria-hidden': 'true' }, Array.from(name)[0] || '나'), h('span', { class: 'user-name' }, name));
}

function toggleDrawer() {
  const open = !document.body.classList.contains('drawer-open');
  document.body.classList.toggle('drawer-open', open);
  UI.menuBtn.setAttribute('aria-expanded', String(open));
  if (open) UI.search.focus();
}
function closeDrawer() {
  if (!document.body.classList.contains('drawer-open')) return;
  document.body.classList.remove('drawer-open');
  UI.menuBtn.setAttribute('aria-expanded', 'false');
}

function renderFilters() {
  clear(UI.filters);
  const opts = [['all', '전체'], ...TYPES.map((t) => [t, TYPE_LABELS[t]])];
  for (const [val, label] of opts) {
    UI.filters.append(h('button', {
      type: 'button', class: 'filter-chip', 'aria-pressed': String(S.typeFilter === val),
      onclick: () => { S.typeFilter = val; renderFilters(); renderProjectList(); },
    }, label));
  }
}

async function loadProjects() {
  try {
    const res = await studioApi.listProjects();
    S.projects = Array.isArray(res.projects) ? res.projects : [];
  } catch (err) {
    handleError(err, '작업 목록을 불러오지 못했습니다: ');
  }
  renderProjectList();
  if (!S.cur) renderMain();
}

function sortedProjects() {
  return S.projects.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function renderProjectList() {
  if (!UI.list) return;
  clear(UI.list);
  const q = S.query.trim().toLowerCase();
  const items = sortedProjects().filter((p) => {
    if (S.typeFilter !== 'all' && p.type !== S.typeFilter) return false;
    if (!q) return true;
    const title = S.cur && S.cur.project.id === p.id ? S.cur.draft.title : p.title;
    return `${title || ''} ${p.description || ''}`.toLowerCase().includes(q);
  });
  if (!S.projects.length) {
    UI.list.append(h('li', { class: 'list-empty' }, '아직 작업이 없습니다. "새 작업"으로 시작해 보세요.'));
    return;
  }
  if (!items.length) {
    UI.list.append(h('li', { class: 'list-empty' }, '조건에 맞는 작업이 없습니다.'));
    return;
  }
  for (const p of items) {
    const active = S.cur && S.cur.project.id === p.id;
    const title = active ? S.cur.draft.title : p.title;
    const type = active ? S.cur.draft.type : p.type;
    UI.list.append(h('li', null,
      h('button', {
        type: 'button', class: `project-item${active ? ' is-active' : ''}`, 'aria-current': active ? 'true' : null,
        onclick: () => openProject(p.id),
      },
      h('span', { class: `type-dot t-${TYPES.includes(type) ? type : 'other'}`, 'aria-hidden': 'true' }),
      h('span', { class: 'pi-main' },
        h('span', { class: 'pi-title' }, title || '제목 없음'),
        h('span', { class: 'pi-meta' },
          TYPE_LABELS[type] || '기타', ' · ', formatDate(p.updatedAt),
          Number.isFinite(p.assetCount) ? ` · 자료 ${p.assetCount}` : ''),
      ),
      active && S.cur.dirty ? h('span', { class: 'dirty-dot' }, h('span', { class: 'sr-only' }, '저장 안 된 변경 있음')) : null,
      ),
    ));
  }
}

function updateProjectInList(project) {
  const i = S.projects.findIndex((p) => p.id === project.id);
  const lite = { ...project };
  delete lite.state;
  if (i >= 0) S.projects[i] = { ...S.projects[i], ...lite };
  else S.projects.unshift(lite);
  renderProjectList();
}

// ======================================================================
// 저장 상태 / 저장
// ======================================================================
/**
 * 버튼의 아이콘·문구를 제자리에서 갱신한다. 자식 노드를 매번 새로 만들면
 * 입력칸 blur(change) → markDirty → 재렌더가 mousedown~mouseup 사이에 일어날 때
 * 클릭 대상이 사라져 click 이 발생하지 않는다. 자식은 pointer-events:none 으로 두어
 * 포인터 대상이 항상 버튼 자신이 되도록 한다.
 */
function setButtonContent(btn, iconName, text) {
  if (!btn.dataset.icon) clear(btn);
  let svg = btn.querySelector(':scope > svg');
  if (!svg || btn.dataset.icon !== iconName) {
    const fresh = icon(iconName, 'icon-sm');
    fresh.style.pointerEvents = 'none';
    if (svg) svg.replaceWith(fresh); else btn.prepend(fresh);
    btn.dataset.icon = iconName;
  }
  let label = btn.querySelector(':scope > span[data-role="label"]');
  if (!label) {
    label = h('span', { 'data-role': 'label' });
    label.style.pointerEvents = 'none';
    btn.append(label);
  }
  if (label.textContent !== text) label.textContent = text;
}

function renderSaveStatus() {
  const el = UI.saveStatus;
  if (!el) return;
  const cur = S.cur;
  if (!cur) { el.hidden = true; return; }
  el.hidden = false;
  let cls = 'is-saved', text = '서버에 저장됨', ic = 'check';
  if (cur.saving) { cls = 'is-saving'; text = '저장 중…'; ic = 'save'; }
  else if (cur.conflict) { cls = 'is-error'; text = '충돌 · 확인 필요'; ic = 'alert'; }
  else if (cur.error) { cls = 'is-error'; text = '저장 실패 · 다시 시도'; ic = 'alert'; }
  else if (cur.dirty) { cls = 'is-dirty'; text = '저장 안 된 변경'; ic = 'pen'; }
  else if (cur.savedAt) { text = `저장됨 · ${formatTime(cur.savedAt)}`; }
  const nextClass = `save-status ${cls}`;
  if (el.className !== nextClass) el.className = nextClass;
  setButtonContent(el, ic, text);
  el.title = cur.dirty || cur.error || cur.conflict ? '눌러서 저장 (Ctrl+S)' : '서버에 저장된 상태';
  if (UI.saveBtn) {
    UI.saveBtn.disabled = cur.saving;
    setButtonContent(UI.saveBtn, 'save', cur.saving ? '저장 중…' : cur.dirty ? '저장' : '저장됨');
    UI.saveBtn.classList.toggle('btn-primary', cur.dirty || !!cur.error || cur.conflict);
  }
}

/**
 * 저장 버튼을 누를 때 입력칸에서 포커스를 빼앗지 않는다. 포커스가 빠지면 change →
 * 상태 문구 변경 → 버튼 크기 변화가 mousedown~mouseup 사이에 일어나 click 이 빠질 수 있다.
 * 확정되지 않은 값은 save() 의 commitActiveField() 가 반영한다.
 */
function keepFocus(e) {
  if (e.button === 0) e.preventDefault();
}

/** 포커스된 입력칸의 change 를 즉시 발생시켜(숫자 X/Y 등) 저장 전에 상태에 반영한다. */
function commitActiveField() {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
  if (el instanceof HTMLInputElement && ['button', 'submit', 'checkbox', 'radio', 'file', 'range', 'color'].includes(el.type)) return;
  el.blur(); // 브라우저가 값이 바뀐 경우에만 change 를 보낸다
  el.focus({ preventScroll: true });
}

function onStatusClick() {
  if (!S.cur) return;
  commitActiveField();
  if (S.cur.conflict) openConflictDialog();
  else if (S.cur.dirty || S.cur.error) save();
}

function markDirty() {
  const cur = S.cur;
  if (!cur) return;
  const was = cur.dirty;
  cur.dirty = true;
  cur.rev += 1;
  cur.error = '';
  renderSaveStatus();
  if (!was) renderProjectList();
}

async function save({ force = false } = {}) {
  const cur = S.cur;
  if (!cur || cur.saving) return false;
  commitActiveField();
  if (cur.conflict && !force) { openConflictDialog(); return false; }
  if (!cur.dirty && !force) { notify('이미 서버에 저장된 상태입니다.', 'info'); return true; }
  const problem = validateDraft(cur.draft);
  if (problem) { cur.error = problem; renderSaveStatus(); notify(problem, 'error'); return false; }
  cur.saving = true;
  cur.error = '';
  renderSaveStatus();
  const rev = cur.rev;
  const d = cur.draft;
  try {
    const res = await studioApi.patchProject(cur.project.id, {
      version: cur.project.version,
      title: d.title.trim(),
      description: d.description,
      type: d.type,
      state: d.state,
    });
    if (S.cur !== cur) return true;
    cur.project = { ...cur.project, ...res.project };
    cur.savedAt = new Date();
    cur.conflict = false;
    if (cur.rev === rev) cur.dirty = false;
    updateProjectInList(res.project);
    renderProjectMeta();
    return true;
  } catch (err) {
    if (S.cur !== cur) return false;
    if (err.code === 'VERSION_CONFLICT' || (err.status === 409 && !err.code)) {
      cur.conflict = true;
      openConflictDialog();
    } else if (err.status === 401) {
      cur.error = err.message;
      reauth();
    } else {
      cur.error = err.message;
      notify(`저장하지 못했습니다. ${err.message}`, 'error');
    }
    return false;
  } finally {
    cur.saving = false;
    renderSaveStatus();
  }
}

async function openConflictDialog() {
  const cur = S.cur;
  if (!cur || cur.conflictOpen) return;
  cur.conflictOpen = true;
  let latest = null;
  try {
    latest = (await studioApi.getProject(cur.project.id)).project;
  } catch (err) {
    if (err.status === 404) {
      cur.conflictOpen = false;
      const again = await choose({
        title: '서버에서 이 작업이 삭제되었습니다',
        message: '다른 창이나 기기에서 삭제된 것 같습니다. 화면에 남은 내용을 새 작업으로 저장할 수 있습니다.',
        choices: [{ value: 'copy', label: '새 작업으로 저장' }],
      });
      if (again === 'copy') saveAsCopy(cur);
      return;
    }
  }
  const info = latest
    ? h('dl', { class: 'meta-list' },
      h('dt', null, '서버 최신본'), h('dd', null, `${latest.title || '제목 없음'} · 버전 ${latest.version}`),
      h('dt', null, '마지막 저장'), h('dd', null, formatDate(latest.updatedAt) || '알 수 없음'),
      h('dt', null, '내 화면 기준'), h('dd', null, `버전 ${cur.project.version} 에서 수정함`))
    : h('p', { class: 'muted' }, '서버 최신본 정보를 가져오지 못했습니다.');
  const choice = await openDialog({
    title: '다른 곳에서 먼저 저장했습니다',
    message: '다른 창이나 기기에서 이 작업이 바뀌었습니다. 내 변경은 아직 화면에 그대로 있으며, 자동으로 덮어쓰지 않았습니다.',
    content: info,
    className: 'dialog-wide',
    actions: [
      { value: 'copy', label: '내 변경을 새 작업으로 따로 저장', variant: 'primary' },
      { value: 'load', label: '서버 최신본 불러오기 (내 변경 버림)' },
      { value: 'overwrite', label: '내 변경으로 덮어쓰기', variant: 'danger' },
    ],
  });
  cur.conflictOpen = false;
  if (S.cur !== cur || !choice) { renderSaveStatus(); return; }
  if (choice === 'copy') {
    await saveAsCopy(cur);
  } else if (choice === 'load') {
    const ok = await confirmDialog({ title: '내 변경 버리기', message: '화면에서 저장하지 않은 변경이 사라지고 서버 최신본으로 바뀝니다. 계속할까요?', okLabel: '최신본 불러오기', danger: true });
    if (!ok) return;
    try {
      const fresh = (await studioApi.getProject(cur.project.id)).project;
      S.cur = makeCur(fresh);
      S.cur.savedAt = new Date();
      updateProjectInList(fresh);
      renderMain();
      notify('서버 최신본을 불러왔습니다.', 'success');
    } catch (err) { handleError(err, '최신본을 불러오지 못했습니다: '); }
  } else if (choice === 'overwrite') {
    const ok = await confirmDialog({ title: '정말 덮어쓸까요?', message: '다른 곳에서 저장한 내용이 내 화면의 내용으로 바뀝니다. 되돌릴 수 없습니다.', okLabel: '덮어쓰기', danger: true });
    if (!ok) return;
    try {
      const fresh = (await studioApi.getProject(cur.project.id)).project;
      cur.project.version = fresh.version;
      cur.conflict = false;
      if (await save({ force: true })) notify('내 변경으로 덮어썼습니다.', 'success');
    } catch (err) { handleError(err, '덮어쓰지 못했습니다: '); }
  }
}

async function saveAsCopy(cur) {
  const d = cur.draft;
  try {
    const created = (await studioApi.createProject({
      title: `${d.title.trim() || '제목 없음'} (내 변경본)`.slice(0, 120),
      description: d.description,
      type: d.type,
    })).project;
    const state = deepClone(d.state);
    // 자료는 작업마다 따로 보관되므로 다른 작업의 이미지 연결은 풀어 둔다.
    state.editor.baseAssetId = null;
    state.editor.imageLayers = [];
    for (const c of state.story.characters) c.assetId = null;
    for (const s of state.story.scenes) s.assetId = null;
    const saved = (await studioApi.patchProject(created.id, { version: created.version, state })).project;
    updateProjectInList(saved);
    S.cur = makeCur(saved);
    S.cur.savedAt = new Date();
    S.assets = [];
    S.tab = 'story';
    setHash(saved.id);
    renderMain();
    renderProjectList();
    notify('내 변경을 새 작업으로 저장했습니다. 이미지 연결(배경·레이어·인물·장면)은 원래 작업에 남아 있습니다.', 'success');
  } catch (err) {
    handleError(err, '새 작업으로 저장하지 못했습니다: ');
  }
}

/** 저장되지 않은 변경이 있을 때 이동 전에 묻는다. true 면 진행. */
async function confirmLeave(actionLabel = '이동') {
  if (!S.cur || !S.cur.dirty) return true;
  const v = await choose({
    title: '저장하지 않은 변경이 있습니다',
    message: `"${S.cur.draft.title || '제목 없음'}"의 변경 내용이 아직 서버에 저장되지 않았습니다.`,
    choices: [
      { value: 'save', label: `저장하고 ${actionLabel}` },
      { value: 'discard', label: `저장하지 않고 ${actionLabel}`, variant: 'danger' },
    ],
  });
  if (v === 'save') return save();
  return v === 'discard';
}

function setHash(id) {
  const target = id ? `#/p/${encodeURIComponent(id)}` : ' ';
  history.replaceState(null, '', id ? target : location.pathname + location.search);
}

// ======================================================================
// 프로젝트 열기 / 만들기 / 삭제
// ======================================================================
async function openProject(id, { fromHash = false } = {}) {
  if (S.cur && S.cur.project.id === id) { closeDrawer(); return; }
  if (S.loadingProject) return;
  if (!fromHash && !(await confirmLeave())) return;
  S.loadingProject = true;
  clear(UI.main).append(h('div', { class: 'main-loading', role: 'status' }, '작업을 불러오는 중…'));
  closeDrawer();
  try {
    const [p, a] = await Promise.all([studioApi.getProject(id), studioApi.listAssets(id)]);
    S.cur = makeCur(p.project);
    S.assets = Array.isArray(a.assets) ? a.assets : [];
    S.tab = 'story';
    setHash(id);
  } catch (err) {
    S.cur = null;
    S.assets = [];
    setHash(null);
    handleError(err, '작업을 열지 못했습니다: ');
  } finally {
    S.loadingProject = false;
  }
  renderMain();
  renderProjectList();
  renderSaveStatus();
  if (S.cur) UI.main.focus({ preventScroll: true });
}

async function closeProject() {
  if (!(await confirmLeave('닫기'))) return;
  S.cur = null;
  S.assets = [];
  setHash(null);
  renderMain();
  renderProjectList();
  renderSaveStatus();
}

async function newProjectDialog() {
  if (!(await confirmLeave())) return;
  const title = h('input', { id: 'np-title', class: 'input', maxLength: 120, required: true, placeholder: '예: 가을 남해 여행 기록' });
  const type = h('select', { id: 'np-type', class: 'input' }, ...TYPES.map((t) => h('option', { value: t }, TYPE_LABELS[t])));
  const desc = h('textarea', { id: 'np-desc', class: 'input', rows: 3, maxLength: 2000, placeholder: '어떤 작업인지 짧게 (선택)' });
  await openDialog({
    title: '새 작업 만들기',
    content: h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', { htmlFor: 'np-title' }, '제목'), title),
      h('div', { class: 'field' }, h('label', { htmlFor: 'np-type' }, '종류'), type),
      h('div', { class: 'field' }, h('label', { htmlFor: 'np-desc' }, '설명'), desc),
    ),
    initialFocus: '#np-title',
    actions: [{ value: 'create', label: '만들기', variant: 'primary' }],
    onAction: async (_v, _f, showError) => {
      const t = title.value.trim();
      if (!t) { showError('제목을 입력해 주세요.'); title.focus(); return false; }
      try {
        const res = await studioApi.createProject({ title: t, description: desc.value.trim(), type: type.value });
        await afterCreate(res.project);
        return 'ok';
      } catch (err) {
        if (err.status === 401) { reauth(); return 'ok'; }
        showError(err.message);
        return false;
      }
    },
  });
}

async function afterCreate(project) {
  updateProjectInList(project);
  S.cur = null;
  await openProject(project.id, { fromHash: true });
  notify('새 작업을 만들었습니다.', 'success');
}

async function deleteProject() {
  const cur = S.cur;
  if (!cur) return;
  const ok = await confirmDialog({
    title: '작업 삭제',
    message: `"${cur.draft.title || '제목 없음'}" 작업과 이 작업에 올린 자료 이미지가 서버에서 삭제됩니다. 되돌릴 수 없으니 필요하면 먼저 백업을 내려받으세요.`,
    okLabel: '영구 삭제',
    danger: true,
  });
  if (!ok) return;
  try {
    await studioApi.deleteProject(cur.project.id);
    S.projects = S.projects.filter((p) => p.id !== cur.project.id);
    S.assets.forEach((a) => forgetImage(a.id));
    S.cur = null;
    S.assets = [];
    setHash(null);
    renderMain();
    renderProjectList();
    renderSaveStatus();
    notify('작업을 삭제했습니다.', 'success');
  } catch (err) {
    handleError(err, '삭제하지 못했습니다: ');
  }
}

// ======================================================================
// 백업 내보내기 / 가져오기
// ======================================================================
async function exportProject() {
  const cur = S.cur;
  if (!cur) return;
  if (cur.dirty) {
    const v = await choose({
      title: '저장하지 않은 변경이 있습니다',
      message: '백업은 서버에 저장된 내용으로 만들어집니다.',
      choices: [{ value: 'save', label: '저장하고 내보내기' }, { value: 'as-is', label: '저장된 내용만 내보내기' }],
    });
    if (!v) return;
    if (v === 'save' && !(await save())) return;
  }
  notify('백업 파일을 만드는 중입니다…', 'info');
  try {
    const res = await studioApi.exportProject(cur.project.id);
    const blob = await res.blob();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `${safeFileName(cur.draft.title)}-백업-${stamp}.json`);
    notify(`백업 파일(${formatBytes(blob.size)})을 내려받았습니다. 원본 이미지가 포함되어 있으니 안전한 곳에 보관하세요.`, 'success');
  } catch (err) {
    handleError(err, '백업을 만들지 못했습니다: ');
  }
}

async function importBackup(file) {
  if (file.size > MAX_IMPORT) { notify('백업 파일이 너무 큽니다. 최대 64MB까지 가져올 수 있습니다.', 'error'); return; }
  let text;
  try { text = await file.text(); } catch { notify('파일을 읽지 못했습니다.', 'error'); return; }
  let data;
  try { data = JSON.parse(text); } catch { notify('JSON 형식이 아닙니다. 나의 창작실에서 내보낸 백업 파일인지 확인해 주세요.', 'error'); return; }
  if (!data || data.format !== 'personal-studio-backup' || !data.project || typeof data.project !== 'object') {
    notify('나의 창작실 백업 파일 형식이 아닙니다.', 'error');
    return;
  }
  const n = Array.isArray(data.assets) ? data.assets.length : 0;
  const ok = await confirmDialog({
    title: '백업 가져오기',
    message: `"${str(data.project.title, 120) || '제목 없음'}" 백업을 새 작업으로 추가합니다 (이미지 ${n}개). 기존 작업은 바뀌지 않습니다.`,
    okLabel: '새 작업으로 가져오기',
  });
  if (!ok) return;
  if (!(await confirmLeave())) return;
  notify('가져오는 중입니다…', 'info');
  try {
    const res = await studioApi.importBackup(text);
    S.cur = null;
    await afterCreateImport(res.project);
  } catch (err) {
    handleError(err, '가져오지 못했습니다: ');
  }
}

async function afterCreateImport(project) {
  updateProjectInList(project);
  await openProject(project.id, { fromHash: true });
  notify('백업을 새 작업으로 가져왔습니다.', 'success');
  loadProjects();
}

// ======================================================================
// 자료 (이미지 업로드)
// ======================================================================
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : '');
    };
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(file);
  });
}

function trimName(name) {
  const n = String(name || 'image').replace(/[\u0000-\u001f]/g, '').trim() || 'image';
  if (n.length <= 120) return n;
  const dot = n.lastIndexOf('.');
  const ext = dot > 0 && n.length - dot <= 6 ? n.slice(dot) : '';
  return n.slice(0, 120 - ext.length) + ext;
}

async function uploadFiles(files) {
  const cur = S.cur;
  if (!cur) return [];
  const created = [];
  const list = Array.from(files);
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (!ALLOWED_MIME.includes(f.type)) { notify(`"${f.name}": PNG, JPEG, WebP 이미지만 올릴 수 있습니다.`, 'error'); continue; }
    if (f.size > MAX_UPLOAD) { notify(`"${f.name}": 파일당 최대 10MB까지 올릴 수 있습니다.`, 'error'); continue; }
    if (!f.size) { notify(`"${f.name}": 빈 파일입니다.`, 'error'); continue; }
    setUploadProgress(`올리는 중 ${i + 1}/${list.length} · ${f.name}`);
    try {
      const data = await readBase64(f);
      const res = await studioApi.uploadAsset(cur.project.id, trimName(f.name), f.type, data);
      if (S.cur === cur && res.asset) { S.assets.push(res.asset); created.push(res.asset); }
    } catch (err) {
      handleError(err, `"${f.name}" 올리기 실패: `);
      if (err.status === 401) break;
    }
  }
  setUploadProgress('');
  syncAssetCount(cur);
  if (created.length) notify(`이미지 ${created.length}개를 서버 자료함에 올렸습니다.`, 'success');
  renderTabs();
  if (S.tab === 'assets') renderTab();
  return created;
}

async function uploadBlob(blob, name) {
  if (!blob) return null;
  const type = ALLOWED_MIME.includes(blob.type) ? blob.type : 'image/png';
  const file = new File([blob], name || 'image.png', { type });
  const created = await uploadFiles([file]);
  return created[0] || null;
}

/** 이 자료를 쓰는 곳 목록(한국어 설명). */
function assetUsage(state, assetId) {
  const out = [];
  if (state.editor.baseAssetId === assetId) out.push('캔버스 배경');
  const layers = state.editor.imageLayers.filter((l) => l.assetId === assetId).length;
  if (layers) out.push(`이미지 레이어 ${layers}개`);
  const chars = state.story.characters.filter((c) => c.assetId === assetId).length;
  if (chars) out.push(`등장인물 ${chars}명`);
  const scenes = state.story.scenes.filter((s) => s.assetId === assetId).length;
  if (scenes) out.push(`장면 ${scenes}개`);
  return out;
}

function clearAssetRefs(state, assetId) {
  let changed = false;
  if (state.editor.baseAssetId === assetId) { state.editor.baseAssetId = null; changed = true; }
  const before = state.editor.imageLayers.length;
  state.editor.imageLayers = state.editor.imageLayers.filter((l) => l.assetId !== assetId);
  if (state.editor.imageLayers.length !== before) changed = true;
  for (const c of state.story.characters) if (c.assetId === assetId) { c.assetId = null; changed = true; }
  for (const s of state.story.scenes) if (s.assetId === assetId) { s.assetId = null; changed = true; }
  return changed;
}

function syncAssetCount(cur) {
  if (!cur || S.cur !== cur) return;
  const p = S.projects.find((x) => x.id === cur.project.id);
  if (p && 'assetCount' in p) { p.assetCount = S.assets.length; renderProjectList(); }
}

function setUploadProgress(text) {
  const el = document.getElementById('upload-progress');
  if (el) { el.textContent = text; el.hidden = !text; }
}

async function deleteAsset(asset) {
  const cur = S.cur;
  const usage = cur ? assetUsage(cur.draft.state, asset.id) : [];
  const ok = await confirmDialog({
    title: '자료 삭제',
    message: `"${asset.name || '이미지'}"를 서버에서 삭제할까요?${usage.length ? ` 사용 중인 곳(${usage.join(', ')})에서도 빠집니다.` : ''} 되돌릴 수 없습니다.`,
    okLabel: '삭제',
    danger: true,
  });
  if (!ok) return;
  try {
    await studioApi.deleteAsset(asset.id);
    if (S.cur !== cur) return;
    S.assets = S.assets.filter((a) => a.id !== asset.id);
    forgetImage(asset.id);
    syncAssetCount(cur);
    if (clearAssetRefs(cur.draft.state, asset.id)) {
      markDirty();
      notify('자료를 삭제하고 사용 중이던 곳에서도 뺐습니다. 저장을 눌러 반영하세요.', 'info');
    } else {
      notify('자료를 삭제했습니다.', 'success');
    }
    renderTabs();
    renderTab();
  } catch (err) {
    handleError(err, '자료를 삭제하지 못했습니다: ');
  }
}

function renderAssets(root) {
  clear(root);
  const cur = S.cur;
  const input = h('input', { type: 'file', id: 'asset-upload', class: 'sr-only', multiple: true, accept: 'image/png,image/jpeg,image/webp' });
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length) uploadFiles(files);
  });
  const zone = h('div', { class: 'drop-zone' },
    icon('upload', 'icon-lg'),
    h('p', null, h('strong', null, '이미지를 여기로 끌어 놓거나'), ' '),
    input,
    h('label', { htmlFor: 'asset-upload', class: 'btn btn-primary file-btn', tabIndex: 0, role: 'button',
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } },
    icon('upload', 'icon-sm'), h('span', null, '파일 고르기')),
    h('p', { class: 'hint' }, 'PNG · JPEG · WebP, 파일당 최대 10MB. 이 컴퓨터의 로컬 서버에만 보관됩니다.'),
    h('p', { id: 'upload-progress', class: 'upload-progress', role: 'status', hidden: true }),
  );
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) uploadFiles(files);
  });

  const sketchBtn = h('button', { type: 'button', class: 'btn', onclick: async () => {
    const ed = cur.draft.state.editor;
    const asset = await openSketchPad({ width: ed.width, height: ed.height, background: '#ffffff', baseImage: null, uploadBlob, notify, title: '스케치 그리기' });
    if (asset && S.cur === cur) renderTab();
  } }, icon('pen', 'icon-sm'), h('span', null, '스케치 그리기'));
  const grid = h('ul', { class: 'asset-grid', 'aria-label': '올린 자료' });
  if (!S.assets.length) {
    grid.append(h('li', { class: 'empty-note' }, icon('image', 'icon-lg'), h('p', null, '아직 올린 자료가 없습니다.'), h('p', { class: 'muted' }, '여행 사진이나 그림을 올리면 캔버스 배경으로 쓸 수 있습니다.')));
  }
  for (const a of S.assets) {
    const usage = assetUsage(cur.draft.state, a.id);
    const inUse = cur.draft.state.editor.baseAssetId === a.id;
    const url = assetUrl(a);
    const img = h('img', { src: url, alt: a.name || '자료 이미지', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => { img.replaceWith(h('div', { class: 'thumb-missing' }, icon('alert'), h('span', null, '미리보기 불가'))); });
    grid.append(h('li', { class: `asset-card${inUse ? ' in-use' : ''}` },
      h('div', { class: 'thumb' }, img, usage.length ? h('span', { class: 'badge badge-on', title: usage.join(', ') }, `사용 중 · ${usage[0]}${usage.length > 1 ? ` 외 ${usage.length - 1}` : ''}`) : null),
      h('div', { class: 'asset-info' },
        h('p', { class: 'asset-name', title: a.name || '' }, a.name || '이름 없음'),
        h('p', { class: 'asset-meta' }, `${formatBytes(a.size)} · ${String(a.mime || '').replace('image/', '').toUpperCase()}${a.createdAt ? ` · ${formatDate(a.createdAt)}` : ''}`),
      ),
      h('div', { class: 'asset-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', disabled: inUse, onclick: () => {
          cur.draft.state.editor.baseAssetId = a.id;
          markDirty();
          switchTab('image');
          notify('캔버스 배경으로 지정했습니다. 저장을 눌러 보관하세요.', 'info');
        } }, icon('image', 'icon-sm'), h('span', null, '캔버스 배경')),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => addAssetAsLayer(cur, a) }, icon('layers', 'icon-sm'), h('span', null, '레이어로')),
        h('a', { class: 'icon-btn', href: `${url}?download=1`, download: safeFileName(a.name, 'image'), 'aria-label': `${a.name || '이미지'} 내려받기`, title: '원본 내려받기' }, icon('download')),
        h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `${a.name || '이미지'} 삭제`, onclick: () => deleteAsset(a) }, icon('trash')),
      ),
    ));
  }

  root.append(h('div', { class: 'assets-wrap' },
    h('section', { class: 'panel', 'aria-labelledby': 'assets-heading' },
      h('div', { class: 'panel-head' },
        h('h2', { id: 'assets-heading', class: 'panel-title' }, icon('folder'), '자료함'),
        h('span', { class: 'counter' }, `${S.assets.length}개 · ${formatBytes(S.assets.reduce((s, a) => s + (Number(a.size) || 0), 0))}`),
      ),
      zone,
      h('div', { class: 'btn-row assets-tools' }, sketchBtn,
        h('p', { class: 'hint' }, '스케치는 PNG로 자료함에 저장됩니다. 스케치를 화풍 완성본으로 바꾸는 기능은 AI 연결 후 제공됩니다.')),
      grid,
    ),
  ));
}

function addAssetAsLayer(cur, asset) {
  const ed = cur.draft.state.editor;
  if (ed.imageLayers.length >= MAX_IMAGE_LAYERS) { notify(`이미지 레이어는 최대 ${MAX_IMAGE_LAYERS}개까지 넣을 수 있습니다.`, 'error'); return; }
  const img = new Image();
  const finish = (nw, nh) => {
    const maxW = ed.width * 0.5, maxH = ed.height * 0.5;
    const ratio = nw && nh ? nw / nh : 1;
    let w = maxW, hgt = w / ratio;
    if (hgt > maxH) { hgt = maxH; w = hgt * ratio; }
    ed.imageLayers.push({ id: uid('img'), assetId: asset.id, x: Math.round((ed.width - w) / 2), y: Math.round((ed.height - hgt) / 2), w: Math.round(w), h: Math.round(hgt), opacity: 1 });
    markDirty();
    switchTab('image');
    notify('이미지 레이어로 추가했습니다. 끌어서 위치와 크기를 조정하세요.', 'success');
  };
  img.onload = () => finish(img.naturalWidth, img.naturalHeight);
  img.onerror = () => finish(1, 1);
  img.src = assetUrl(asset);
}

// ======================================================================
// 정보 · 메모 탭
// ======================================================================
function renderInfo(root) {
  clear(root);
  const cur = S.cur;
  const d = cur.draft;
  const type = h('select', { id: 'info-type', class: 'input' }, ...TYPES.map((t) => h('option', { value: t, selected: d.type === t }, TYPE_LABELS[t])));
  type.addEventListener('change', () => { d.type = type.value; markDirty(); renderProjectMeta(); renderProjectList(); });
  const desc = h('textarea', { id: 'info-desc', class: 'input', rows: 3, maxLength: 2000, value: d.description, placeholder: '이 작업에 대한 짧은 설명' });
  desc.addEventListener('input', () => { d.description = desc.value; markDirty(); });
  const notes = h('textarea', { id: 'info-notes', class: 'input notes-input', rows: 12, maxLength: MAX_NOTES, value: d.state.notes, placeholder: '아이디어, 할 일, 참고 메모를 자유롭게 적어 두세요.' });
  notes.addEventListener('input', () => { d.state.notes = notes.value; markDirty(); });

  root.append(h('div', { class: 'info-grid' },
    h('section', { class: 'panel', 'aria-labelledby': 'notes-heading' },
      h('h2', { id: 'notes-heading', class: 'panel-title' }, icon('note'), '작업 메모'),
      h('label', { class: 'sr-only', htmlFor: 'info-notes' }, '작업 메모'),
      notes,
    ),
    h('div', { class: 'stack' },
      h('section', { class: 'panel', 'aria-labelledby': 'detail-heading' },
        h('h2', { id: 'detail-heading', class: 'panel-title' }, icon('info'), '작업 정보'),
        h('div', { class: 'field' }, h('label', { htmlFor: 'info-type' }, '종류'), type),
        h('div', { class: 'field' }, h('label', { htmlFor: 'info-desc' }, '설명'), desc),
        h('dl', { class: 'meta-list' },
          h('dt', null, '만든 날'), h('dd', null, formatDate(cur.project.createdAt) || '-'),
          h('dt', null, '서버 저장'), h('dd', null, formatDate(cur.project.updatedAt) || '-'),
          h('dt', null, '저장 버전'), h('dd', null, String(cur.project.version ?? '-')),
          h('dt', null, '보관 위치'), h('dd', null, '이 컴퓨터의 로컬 서버'),
        ),
      ),
      h('section', { class: 'panel', 'aria-labelledby': 'backup-heading' },
        h('h2', { id: 'backup-heading', class: 'panel-title' }, icon('exportIcon'), '백업'),
        h('p', { class: 'muted small-text' }, '작업 내용과 원본 이미지를 JSON 파일 하나로 내려받습니다. 계정 정보나 비밀번호는 들어가지 않습니다. 다른 컴퓨터의 나의 창작실에서 "백업 파일 가져오기"로 새 작업으로 불러올 수 있습니다.'),
        h('button', { type: 'button', class: 'btn', onclick: exportProject }, icon('download', 'icon-sm'), h('span', null, '백업 내려받기')),
      ),
      h('section', { class: 'panel danger-zone', 'aria-labelledby': 'danger-heading' },
        h('h2', { id: 'danger-heading', class: 'panel-title' }, icon('trash'), '작업 삭제'),
        h('p', { class: 'muted small-text' }, '작업과 자료 이미지가 서버에서 영구 삭제됩니다.'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: deleteProject }, icon('trash', 'icon-sm'), h('span', null, '이 작업 삭제')),
      ),
    ),
  ));
}

// ======================================================================
// 본문 렌더링
// ======================================================================
function renderMain() {
  if (!UI.main) return;
  clear(UI.main);
  UI.saveBtn = null;
  UI.tabbar = null;
  UI.tabPanel = null;
  UI.meta = null;
  if (!S.cur) { renderHome(); renderSaveStatus(); return; }
  const cur = S.cur;

  const titleInput = h('input', { id: 'project-title', class: 'title-input', value: cur.draft.title, maxLength: 120, placeholder: '작업 제목', autocomplete: 'off' });
  titleInput.addEventListener('input', () => { cur.draft.title = titleInput.value; markDirty(); renderProjectList(); });
  UI.meta = h('p', { class: 'ph-meta' });
  UI.saveBtn = h('button', { type: 'button', class: 'btn', onclick: () => save(), onmousedown: keepFocus, 'aria-keyshortcuts': 'Control+S' });

  const head = h('header', { class: 'project-head' },
    h('div', { class: 'ph-main' },
      h('label', { class: 'sr-only', htmlFor: 'project-title' }, '작업 제목'),
      titleInput,
      UI.meta,
    ),
    h('div', { class: 'ph-actions' },
      UI.saveBtn,
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: exportProject, title: '백업 내려받기' }, icon('exportIcon', 'icon-sm'), h('span', { class: 'hide-sm' }, '백업')),
      h('button', { type: 'button', class: 'icon-btn', onclick: closeProject, 'aria-label': '작업 닫기', title: '작업 닫기' }, icon('close')),
    ),
  );
  UI.tabbar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '작업 화면' });
  UI.tabPanel = h('div', { class: 'tab-panel', role: 'tabpanel', id: 'tab-panel', tabIndex: -1 });
  const top = h('div', { class: 'project-top' }, head, UI.tabbar);
  UI.main.append(top, UI.tabPanel);
  if (UI.headObserver) UI.headObserver.disconnect();
  if ('ResizeObserver' in window) {
    UI.headObserver = new ResizeObserver(() => UI.main && UI.main.style.setProperty('--head-h', `${Math.ceil(top.getBoundingClientRect().height)}px`));
    UI.headObserver.observe(top);
  }
  renderProjectMeta();
  renderTabs();
  renderTab();
  renderSaveStatus();
}

function renderProjectMeta() {
  if (!UI.meta || !S.cur) return;
  const cur = S.cur;
  clear(UI.meta).append(
    h('span', { class: `type-tag t-${cur.draft.type}` }, TYPE_LABELS[cur.draft.type] || '기타'),
    h('span', null, `서버 저장 ${formatDate(cur.project.updatedAt) || '-'}`),
    h('span', { class: 'hide-sm' }, `버전 ${cur.project.version ?? '-'}`),
  );
}

function renderTabs() {
  if (!UI.tabbar) return;
  clear(UI.tabbar);
  TABS.forEach((t) => {
    const selected = S.tab === t.id;
    const label = t.id === 'assets' ? `${t.label} ${S.assets.length}` : t.label;
    const btn = h('button', {
      type: 'button', role: 'tab', id: `tab-${t.id}`, class: 'tab', 'aria-selected': String(selected),
      'aria-controls': 'tab-panel', tabIndex: selected ? 0 : -1, onclick: () => switchTab(t.id),
    }, icon(t.icon, 'icon-sm'), h('span', null, label));
    btn.addEventListener('keydown', (e) => {
      const i = TABS.findIndex((x) => x.id === S.tab);
      let n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = TABS.length - 1;
      if (n >= 0) {
        e.preventDefault();
        switchTab(TABS[n].id);
        document.getElementById(`tab-${TABS[n].id}`)?.focus();
      }
    });
    UI.tabbar.append(btn);
  });
}

function switchTab(id) {
  if (!S.cur) return;
  S.tab = id;
  renderTabs();
  renderTab();
}

function renderTab() {
  const panel = UI.tabPanel;
  if (!panel || !S.cur) return;
  panel.setAttribute('aria-labelledby', `tab-${S.tab}`);
  const getState = () => S.cur.draft.state;
  if (S.tab === 'story') {
    renderStory(panel, {
      getState, markDirty, notify, choose, confirm: confirmDialog, aiBlocked,
      getAssets: () => S.assets, uploadFiles, projectTitle: () => S.cur.draft.title, switchTab,
      sendToCanvas: (text) => {
        const ed = S.cur.draft.state.editor;
        const t = String(text || '').trim();
        if (!t) { notify('보낼 장면 제목이 비어 있습니다.', 'error'); return; }
        if (ed.textLayers.length >= MAX_LAYERS) { notify(`문구는 최대 ${MAX_LAYERS}개까지 추가할 수 있습니다.`, 'error'); return; }
        ed.textLayers.push(makeLayer(ed, t.slice(0, 80)));
        markDirty();
        switchTab('image');
        notify('장면 제목을 캔버스 문구로 추가했습니다.', 'success');
      },
    });
  } else if (S.tab === 'image') {
    renderEditor(panel, {
      getState, markDirty, notify, aiBlocked,
      getAssets: () => S.assets,
      uploadFiles,
      uploadBlob,
      confirm: confirmDialog,
      projectTitle: () => S.cur.draft.title,
    });
  } else if (S.tab === 'prompt') {
    renderPromptLab(panel, { getState, markDirty, notify, aiBlocked, confirm: confirmDialog, switchTab });
  } else if (S.tab === 'assets') {
    renderAssets(panel);
  } else {
    renderInfo(panel);
  }
}

function renderHome() {
  const name = (S.user && S.user.name) || '나';
  const qTitle = h('input', { id: 'quick-title', class: 'input', maxLength: 120, placeholder: '새 작업 제목', autocomplete: 'off' });
  const qType = h('select', { id: 'quick-type', class: 'input', 'aria-label': '종류' }, ...TYPES.map((t) => h('option', { value: t }, TYPE_LABELS[t])));
  const qErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const quick = h('form', { class: 'quick-form', novalidate: true },
    h('label', { class: 'sr-only', htmlFor: 'quick-title' }, '새 작업 제목'),
    qTitle, qType,
    h('button', { type: 'submit', class: 'btn btn-primary' }, icon('plus', 'icon-sm'), h('span', null, '시작')),
  );
  quick.addEventListener('submit', async (e) => {
    e.preventDefault();
    qErr.hidden = true;
    const t = qTitle.value.trim();
    if (!t) { qErr.textContent = '제목을 입력해 주세요.'; qErr.hidden = false; qTitle.focus(); return; }
    try {
      const res = await studioApi.createProject({ title: t, type: qType.value, description: '' });
      await afterCreate(res.project);
    } catch (err) {
      if (err.status === 401) reauth();
      else { qErr.textContent = err.message; qErr.hidden = false; }
    }
  });

  const recent = sortedProjects().slice(0, 6);
  const recentList = h('ul', { class: 'recent-list' });
  if (!recent.length) {
    recentList.append(h('li', { class: 'list-empty' }, '최근 작업이 없습니다.'));
  }
  for (const p of recent) {
    recentList.append(h('li', null, h('button', { type: 'button', class: 'recent-item', onclick: () => openProject(p.id) },
      h('span', { class: `type-tag t-${TYPES.includes(p.type) ? p.type : 'other'}` }, TYPE_LABELS[p.type] || '기타'),
      h('span', { class: 'ri-title' }, p.title || '제목 없음'),
      h('span', { class: 'ri-date' }, formatDate(p.updatedAt)),
    )));
  }

  const ai = !!(S.status && S.status.ai && S.status.ai.configured);
  UI.main.append(h('div', { class: 'home' },
    h('section', { class: 'home-desk', 'aria-labelledby': 'home-title' },
      h('p', { class: 'eyebrow' }, new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())),
      h('h1', { id: 'home-title', class: 'home-title' }, `${name}님의 책상`),
      h('p', { class: 'muted' }, '대본을 다듬고, 장면을 나누고, 썸네일을 직접 꾸미는 개인 작업 공간입니다.'),
      quick,
      qErr,
    ),
    h('div', { class: 'home-cols' },
      h('section', { class: 'panel', 'aria-labelledby': 'recent-heading' },
        h('h2', { id: 'recent-heading', class: 'panel-title' }, icon('clock'), '최근 작업'),
        recentList,
      ),
      h('section', { class: 'panel', 'aria-labelledby': 'now-heading' },
        h('h2', { id: 'now-heading', class: 'panel-title' }, icon('server'), '지금 이 작업실은'),
        h('ul', { class: 'fact-list' },
          h('li', null, h('span', { class: 'fact-k' }, '저장'), h('span', null, '이 컴퓨터에서 실행 중인 로컬 서버에 보관')),
          h('li', null, h('span', { class: 'fact-k' }, '다른 기기'), h('span', null, '아직 연결 안 됨 · 백업 파일로 옮기기 가능')),
          h('li', null, h('span', { class: 'fact-k' }, 'AI'), h('span', null, ai ? '서버 설정 감지 · 화면 기능은 아직 없음' : 'AI 미연결 · 유료 호출 없음')),
          h('li', null, h('span', { class: 'fact-k' }, '직접 가능'), h('span', null, '대본 편집, 로컬 장면 분할, 이미지 자료, 썸네일 PNG')),
        ),
        h('button', { type: 'button', class: 'btn btn-quiet btn-sm', onclick: openSettings }, icon('settings', 'icon-sm'), h('span', null, '자세히 보기')),
      ),
    ),
  ));
}

// ======================================================================
// 설정
// ======================================================================
async function openSettings() {
  try { S.status = await studioApi.status(); } catch { /* 마지막 상태 사용 */ }
  const st = S.status || {};
  if (st.authenticated === false && S.user) { reauth(); return; }
  const user = st.user || S.user || {};
  const ai = !!(st.ai && st.ai.configured);
  const row = (label, value, tone) => h('div', { class: 'set-row' },
    h('span', { class: 'set-k' }, label),
    h('span', { class: `set-v${tone ? ` tone-${tone}` : ''}` }, value));

  const content = h('div', { class: 'settings' },
    h('section', null,
      h('h3', null, icon('lock', 'icon-sm'), '계정'),
      row('이름', user.name || '-'),
      row('이메일', user.email || '-'),
      h('p', { class: 'muted small-text' }, '이 서버의 소유자 계정은 1개뿐이며 새 가입은 막혀 있습니다. 비밀번호 찾기 기능은 아직 없습니다.'),
    ),
    h('section', null,
      h('h3', null, icon('server', 'icon-sm'), '저장과 실행 환경'),
      row('저장 위치', st.storage === 'server' ? '로컬 서버 (SQLite + 이미지 파일)' : String(st.storage || '알 수 없음')),
      row('배포 상태', st.deployment === 'local' ? '로컬 전용 시제품' : String(st.deployment || '알 수 없음'), 'warn'),
      row('여러 기기 동기화', '아직 사용할 수 없음', 'warn'),
      h('p', { class: 'muted small-text' }, '지금은 이 컴퓨터에서 실행한 서버 주소로 접속한 브라우저에서만 작업이 보입니다. 집·회사·휴대폰에서 같은 작업을 이어 쓰려면 HTTPS 서버 배포가 필요하며, 이는 별도 승인 후 진행할 다음 단계입니다. 그전에는 "백업 내려받기"와 "백업 파일 가져오기"로 옮길 수 있습니다.'),
    ),
    h('section', null,
      h('h3', null, icon('plug', 'icon-sm'), 'AI 기능'),
      row('상태', ai ? '서버 설정 감지 · 화면 기능 미구현' : 'AI 미연결', 'off'),
      h('p', { class: 'muted small-text' }, 'AI 대본 다듬기·이미지 생성 버튼은 보이지만 요청을 보내지 않습니다. 가짜 결과를 만들지 않으며 유료 호출이나 자동 결제도 일어나지 않습니다. 제공자·키·모델을 확인하고 승인한 뒤에 연결합니다.'),
    ),
    h('section', null,
      h('h3', null, icon('info', 'icon-sm'), '개인정보와 단축키'),
      h('p', { class: 'muted small-text' }, '이 화면은 외부 글꼴·분석 도구·제3자 서버를 사용하지 않고, 같은 서버의 API에만 요청합니다.'),
      h('ul', { class: 'kbd-list' },
        h('li', null, h('kbd', null, 'Ctrl'), '+', h('kbd', null, 'S'), ' 저장 (Mac은 ⌘+S)'),
        h('li', null, h('kbd', null, '/'), ' 작업 검색'),
        h('li', null, h('kbd', null, '방향키'), ' 캔버스에서 선택한 문구 이동 (Shift: 10px)'),
        h('li', null, h('kbd', null, 'Esc'), ' 대화상자 닫기 · 문구 선택 해제'),
      ),
    ),
  );
  const v = await openDialog({
    title: '설정 · 상태',
    content,
    className: 'dialog-wide',
    actions: [{ value: 'close', label: '닫기', variant: 'primary' }, { value: 'logout', label: '로그아웃', variant: 'quiet' }],
    hideCancel: true,
  });
  if (v === 'logout') logout();
}

async function logout() {
  if (!(await confirmLeave('로그아웃'))) return;
  try {
    await studioApi.logout();
  } catch (err) {
    if (err.status !== 401) { handleError(err, '로그아웃하지 못했습니다: '); return; }
  }
  S.user = null;
  S.cur = null;
  S.assets = [];
  S.projects = [];
  setHash(null);
  Object.keys(UI).forEach((k) => delete UI[k]);
  document.body.classList.remove('drawer-open');
  renderAuth('login');
}

// ======================================================================
// 전역 단축키 / 이탈 방지
// ======================================================================
window.addEventListener('beforeunload', (e) => {
  if (S.cur && (S.cur.dirty || S.cur.saving)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
    if (S.cur && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      save();
    }
    return;
  }
  if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) {
    closeDrawer();
    UI.menuBtn?.focus();
    return;
  }
  if (e.key === '/' && UI.search && !e.ctrlKey && !e.metaKey) {
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (!typing && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      if (window.matchMedia('(max-width: 860px)').matches) toggleDrawer();
      else UI.search.focus();
    }
  }
});

boot();
