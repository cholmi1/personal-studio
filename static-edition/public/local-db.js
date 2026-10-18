// 브라우저 IndexedDB 저장소. 작업·이미지는 이 브라우저 안에만 보관된다(외부 전송 없음).
// 이전 Node 서버판과 같은 제한·같은 백업 형식을 유지한다.

export class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const KiB = 1024;
const MiB = 1024 * KiB;
export const LIMITS = Object.freeze({
  titleMax: 120,
  descriptionMax: 2000,
  stateBytesMax: 256 * KiB,
  featureStateBytesMax: 100 * KiB,
  assetNameMax: 200,
  assetBytesMax: 10 * MiB,
  assetsPerProjectMax: 200,
  projectsMax: 1000,
  backupBytesMax: 50 * MiB,
  idMax: 64,
});
const PROJECT_TYPES = ['travel', 'story', 'image', 'product', 'other'];
const IMAGE_MIMES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const STATE_KEYS = ['story', 'editor', 'promptLab', 'detailPage', 'featureStudio', 'notes'];
const DB_NAME = 'personal-studio';
const DB_VERSION = 1;
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const QUOTA_MESSAGE = '이 브라우저의 저장 공간이 부족합니다. 먼저 작업 백업 파일을 내려받고, 필요 없는 작업이나 이미지를 지운 뒤 다시 시도해 주세요.';

const fail = (message, status = 400, code = 'VALIDATION_ERROR') => { throw new ApiError(message, status, code); };
const nowIso = () => new Date().toISOString();
const charLength = (s) => [...String(s)].length;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- DB 연결 ----------
let dbPromise = null;
let persistAsked = false;

function mapError(err) {
  if (err instanceof ApiError) return err;
  const name = err && err.name;
  if (name === 'QuotaExceededError' || (err && err.code === 22)) return new ApiError(QUOTA_MESSAGE, 507, 'STORAGE_QUOTA');
  if (name === 'VersionError' || name === 'InvalidStateError') return new ApiError('저장소 연결이 끊겼습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.', 0, 'STORAGE_CLOSED');
  if (name === 'SecurityError' || name === 'UnknownError') return new ApiError('이 브라우저에서 저장소를 사용할 수 없습니다. 시크릿 모드나 저장 차단 설정을 확인해 주세요.', 0, 'STORAGE_UNAVAILABLE');
  return new ApiError(`저장소 작업에 실패했습니다.${err && err.message ? ` (${String(err.message).slice(0, 120)})` : ''}`, 0, 'STORAGE_ERROR');
}

export const mapStorageError = mapError;

function requestPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* best effort */ }
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new ApiError('이 브라우저는 작업 저장소(IndexedDB)를 지원하지 않습니다.', 0, 'STORAGE_UNAVAILABLE')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(mapError(e)); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('assets')) {
        const s = db.createObjectStore('assets', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      requestPersist();
      resolve(db);
    };
    req.onerror = () => reject(mapError(req.error));
    req.onblocked = () => reject(new ApiError('다른 탭이 저장소를 사용 중입니다. 열려 있는 다른 탭을 닫고 다시 시도해 주세요.', 0, 'STORAGE_BLOCKED'));
  }).catch((e) => { dbPromise = null; throw mapError(e); });
  return dbPromise;
}

const wrap = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** 한 트랜잭션 안에서 work(tx)를 실행한다. work가 던지면 전체 롤백된다. */
async function inTx(stores, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(stores, mode); } catch (e) { reject(mapError(e)); return; }
    let result;
    let abortError = null;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(abortError || mapError(tx.error));
    Promise.resolve()
      .then(() => work(tx))
      .then((r) => { result = r; }, (e) => { abortError = mapError(e); try { tx.abort(); } catch { /* 이미 종료 */ } });
  });
}

export async function getStorageInfo() {
  const out = { persisted: false, usage: null, quota: null };
  try { out.persisted = Boolean(await navigator.storage?.persisted?.()); } catch { /* 지원 안 함 */ }
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) { out.usage = e.usage ?? null; out.quota = e.quota ?? null; }
  } catch { /* 지원 안 함 */ }
  return out;
}

/** 테스트 전용: 연결을 닫고 DB를 지운다. */
export async function resetDatabaseForTests() {
  if (dbPromise) { try { (await dbPromise).close(); } catch { /* ignore */ } }
  dbPromise = null;
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
}

// ---------- 이미지 URL 보관(동기 assetUrl 용) ----------
const urls = new Map();
function ensureUrl(row) {
  let u = urls.get(row.id);
  if (!u && row.blob) { u = URL.createObjectURL(row.blob); urls.set(row.id, u); }
  return u || '';
}
function revokeUrl(id) {
  const u = urls.get(id);
  if (u) { URL.revokeObjectURL(u); urls.delete(id); }
}
export function assetObjectUrl(assetId) { return urls.get(String(assetId || '')) || BLANK_IMAGE; }

// ---------- 검증 ----------
export function defaultState() {
  return {
    story: { script: '', scenes: [], characters: [] },
    editor: { width: 1280, height: 720, background: '#e8e3d8', baseAssetId: null, fit: 'cover', textLayers: [], imageLayers: [] },
    promptLab: { picks: {}, subject: '', negative: '', ratio: '16:9', depth: 'auto', seed: null, characterIds: [] },
    detailPage: {
      productAssetIds: [], modelAssetId: null, extraInfo: '', reviewSummary: '',
      settings: { template: 'basic', count: 7, lang: '한국어', ratio: 'portrait', style: '미니멀', mode: 'edit', model: 'none', tone: '' },
      plan: null,
    },
    featureStudio: {},
    notes: '',
  };
}

function validateTitle(v) {
  if (typeof v !== 'string') fail('제목을 입력해 주세요.');
  const t = v.trim();
  if (!t) fail('제목을 입력해 주세요.');
  if (charLength(t) > LIMITS.titleMax) fail(`제목은 ${LIMITS.titleMax}자 이하로 입력해 주세요.`);
  return t;
}
function validateDescription(v) {
  if (typeof v !== 'string') fail('설명 형식이 올바르지 않습니다.');
  if (charLength(v) > LIMITS.descriptionMax) fail(`설명은 ${LIMITS.descriptionMax}자 이하로 입력해 주세요.`);
  return v;
}
function validateType(v) {
  if (!PROJECT_TYPES.includes(v)) fail('작업 종류가 올바르지 않습니다.');
  return v;
}
const byteLen = (s) => new TextEncoder().encode(s).length;

function validateState(state) {
  if (!isPlain(state)) fail('작업 내용 형식이 올바르지 않습니다.');
  const unknown = Object.keys(state).filter((k) => !STATE_KEYS.includes(k));
  if (unknown.length) fail(`작업 내용에 알 수 없는 항목 '${unknown[0].slice(0, 40)}'이(가) 있습니다.`);
  let text;
  try { text = JSON.stringify(state); } catch { fail('작업 내용을 저장할 수 있는 형식으로 바꾸지 못했습니다.'); }
  if (byteLen(text) > LIMITS.stateBytesMax) fail('작업 데이터가 256KiB를 초과했습니다. 내용을 줄여 주세요.', 413, 'STATE_TOO_LARGE');
  if (state.featureStudio !== undefined) {
    if (!isPlain(state.featureStudio)) fail('도구 설정 형식이 올바르지 않습니다.');
    if (byteLen(JSON.stringify(state.featureStudio)) > LIMITS.featureStateBytesMax) fail('도구 설정 데이터가 100KiB를 초과했습니다.', 413, 'FEATURE_STATE_TOO_LARGE');
  }
  return JSON.parse(text);
}

function sniffImageMime(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
function sanitizeAssetName(name, mime) {
  let n = typeof name === 'string' ? name : '';
  n = n.replace(/[\u0000-\u001F\u007F]/g, '').replace(/[\\/]/g, '_').trim().replace(/^\.+/, '');
  if (charLength(n) > LIMITS.assetNameMax) n = [...n].slice(0, LIMITS.assetNameMax).join('');
  return n || `image.${IMAGE_MIMES[mime] || 'img'}`;
}
function validateImage({ name, mime, bytes }, label = '이미지') {
  const m = typeof mime === 'string' ? mime.toLowerCase() : '';
  if (!Object.hasOwn(IMAGE_MIMES, m)) fail('PNG, JPEG, WebP 이미지만 올릴 수 있습니다.', 415, 'UNSUPPORTED_IMAGE_TYPE');
  if (!bytes || !bytes.length) fail(`${label} 파일이 비어 있습니다.`);
  if (bytes.length > LIMITS.assetBytesMax) fail(`${label}은(는) 파일당 최대 10MB까지 올릴 수 있습니다.`, 413, 'ASSET_TOO_LARGE');
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) fail(`${label} 파일 내용이 PNG, JPEG, WebP 형식이 아닙니다.`, 415, 'INVALID_IMAGE');
  if (sniffed !== m) fail(`${label}의 실제 형식(${sniffed})이 지정한 형식(${m})과 다릅니다.`, 415, 'INVALID_IMAGE');
  return { name: sanitizeAssetName(name, m), mime: m, bytes };
}

export function base64ToBytes(data, label = '이미지 데이터') {
  if (typeof data !== 'string' || !data) fail(`${label}가 비어 있습니다.`);
  const clean = data.replace(/\s+/g, '');
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) fail(`${label}의 base64 형식이 올바르지 않습니다.`);
  if (clean.length > Math.ceil(LIMITS.assetBytesMax / 3) * 4 + 8) fail(`${label}가 너무 큽니다. 파일당 최대 10MB까지 가능합니다.`, 413, 'ASSET_TOO_LARGE');
  let bin;
  try { bin = atob(clean); } catch { fail(`${label}를 읽을 수 없습니다.`); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToBase64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(s);
}

// ---------- 직렬화 ----------
function projectJson(row, includeState, assetCount) {
  const p = {
    id: row.id, title: row.title, description: row.description, type: row.type, version: row.version,
    createdAt: row.createdAt, updatedAt: row.updatedAt, assetCount: Number(assetCount || 0),
  };
  if (includeState) p.state = JSON.parse(JSON.stringify(row.state));
  return p;
}
function assetJson(row) {
  return { id: row.id, projectId: row.projectId, name: row.name, mime: row.mime, size: row.size, url: ensureUrl(row), createdAt: row.createdAt };
}
let seqCounter = 0;
const nextSeq = () => Date.now() * 1000 + (seqCounter++ % 1000);

// ---------- 작업 ----------
export async function listProjects() {
  const projects = await inTx(['projects', 'assets'], 'readonly', async (tx) => {
    const rows = await wrap(tx.objectStore('projects').getAll());
    const idx = tx.objectStore('assets').index('projectId');
    const counts = await Promise.all(rows.map((r) => wrap(idx.count(r.id))));
    return rows.map((r, i) => projectJson(r, false, counts[i]));
  });
  projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  return { projects };
}

export async function createProject(body) {
  if (!isPlain(body)) fail('요청 내용이 올바르지 않습니다.');
  const unknown = Object.keys(body).filter((k) => !['title', 'description', 'type'].includes(k));
  if (unknown.length) fail(`요청에 알 수 없는 항목 '${unknown[0].slice(0, 40)}'이(가) 있습니다.`);
  const title = validateTitle(body.title);
  const description = body.description === undefined ? '' : validateDescription(body.description);
  const type = body.type === undefined ? 'other' : validateType(body.type);
  const ts = nowIso();
  const row = { id: crypto.randomUUID(), title, description, type, version: 1, state: defaultState(), createdAt: ts, updatedAt: ts };
  await inTx(['projects'], 'readwrite', async (tx) => {
    const store = tx.objectStore('projects');
    if ((await wrap(store.count())) >= LIMITS.projectsMax) fail(`작업은 최대 ${LIMITS.projectsMax}개까지 만들 수 있습니다.`, 409, 'PROJECT_LIMIT');
    store.add(row);
  });
  return { project: projectJson(row, true, 0) };
}

export async function getProject(id) {
  const { row, assetRows } = await inTx(['projects', 'assets'], 'readonly', async (tx) => {
    const r = await wrap(tx.objectStore('projects').get(String(id)));
    if (!r) fail('작업을 찾을 수 없습니다.', 404, 'NOT_FOUND');
    const a = await wrap(tx.objectStore('assets').index('projectId').getAll(r.id));
    return { row: r, assetRows: a };
  });
  for (const a of assetRows) ensureUrl(a);
  return { project: projectJson(row, true, assetRows.length) };
}

export async function patchProject(id, body) {
  if (!isPlain(body)) fail('요청 내용이 올바르지 않습니다.');
  const unknown = Object.keys(body).filter((k) => !['version', 'title', 'description', 'type', 'state'].includes(k));
  if (unknown.length) fail(`요청에 알 수 없는 항목 '${unknown[0].slice(0, 40)}'이(가) 있습니다.`);
  if (!Number.isInteger(body.version) || body.version < 1) fail('버전 정보가 올바르지 않습니다.');
  const changes = {};
  if (body.title !== undefined) changes.title = validateTitle(body.title);
  if (body.description !== undefined) changes.description = validateDescription(body.description);
  if (body.type !== undefined) changes.type = validateType(body.type);
  if (body.state !== undefined) changes.state = validateState(body.state);
  if (!Object.keys(changes).length) fail('변경할 항목이 없습니다.');
  return inTx(['projects', 'assets'], 'readwrite', async (tx) => {
    const store = tx.objectStore('projects');
    const row = await wrap(store.get(String(id)));
    if (!row) fail('작업을 찾을 수 없습니다.', 404, 'NOT_FOUND');
    if (row.version !== body.version) {
      fail('다른 곳에서 먼저 저장된 내용이 있습니다. 화면의 수정 내용은 유지되었으니 최신 내용을 확인한 뒤 다시 저장해 주세요.', 409, 'VERSION_CONFLICT');
    }
    const next = { ...row, ...changes, version: row.version + 1, updatedAt: nowIso() };
    store.put(next);
    const count = await wrap(tx.objectStore('assets').index('projectId').count(row.id));
    return { project: projectJson(next, true, count) };
  });
}

export async function deleteProject(id) {
  const removed = await inTx(['projects', 'assets'], 'readwrite', async (tx) => {
    const projects = tx.objectStore('projects');
    if (!(await wrap(projects.getKey(String(id))))) fail('작업을 찾을 수 없습니다.', 404, 'NOT_FOUND');
    const assets = tx.objectStore('assets');
    const keys = await wrap(assets.index('projectId').getAllKeys(String(id)));
    for (const k of keys) assets.delete(k);
    projects.delete(String(id));
    return keys;
  });
  for (const k of removed) revokeUrl(k);
  return { ok: true };
}

// ---------- 이미지 ----------
async function storeAsset(projectId, name, mime, bytes) {
  const img = validateImage({ name, mime, bytes });
  const row = {
    id: crypto.randomUUID(), projectId: String(projectId), name: img.name, mime: img.mime, size: img.bytes.length,
    blob: new Blob([img.bytes], { type: img.mime }), createdAt: nowIso(), seq: nextSeq(),
  };
  await inTx(['projects', 'assets'], 'readwrite', async (tx) => {
    if (!(await wrap(tx.objectStore('projects').getKey(row.projectId)))) fail('작업을 찾을 수 없습니다.', 404, 'NOT_FOUND');
    const store = tx.objectStore('assets');
    if ((await wrap(store.index('projectId').count(row.projectId))) >= LIMITS.assetsPerProjectMax) {
      fail(`작업당 이미지는 최대 ${LIMITS.assetsPerProjectMax}개까지 보관할 수 있습니다.`, 409, 'ASSET_LIMIT');
    }
    store.add(row);
  });
  return assetJson(row);
}

export async function listAssets(projectId) {
  const rows = await inTx(['projects', 'assets'], 'readonly', async (tx) => {
    if (!(await wrap(tx.objectStore('projects').getKey(String(projectId))))) fail('작업을 찾을 수 없습니다.', 404, 'NOT_FOUND');
    return wrap(tx.objectStore('assets').index('projectId').getAll(String(projectId)));
  });
  rows.sort((a, b) => (a.seq || 0) - (b.seq || 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
  return { assets: rows.map(assetJson) };
}

export async function uploadAsset(projectId, name, mime, base64Data) {
  const bytes = base64ToBytes(base64Data);
  return { asset: await storeAsset(projectId, name, mime, bytes) };
}

export async function deleteAsset(assetId) {
  await inTx(['assets'], 'readwrite', async (tx) => {
    const store = tx.objectStore('assets');
    if (!(await wrap(store.getKey(String(assetId))))) fail('이미지를 찾을 수 없습니다.', 404, 'NOT_FOUND');
    store.delete(String(assetId));
  });
  revokeUrl(String(assetId));
  return { ok: true };
}

/** AI 모듈용: 저장된 이미지를 바이트로 읽는다. */
export async function getAssetForAi(assetId) {
  const row = await inTx(['assets'], 'readonly', (tx) => wrap(tx.objectStore('assets').get(String(assetId))));
  if (!row || !row.blob) return null;
  return { id: row.id, projectId: row.projectId, mime: row.mime, name: row.name, bytes: new Uint8Array(await row.blob.arrayBuffer()) };
}

/** AI 모듈용: 생성된 이미지를 작업에 저장하고 asset 객체를 돌려준다. */
export async function addAssetFromBytes(projectId, name, mime, bytes) {
  return storeAsset(projectId, name, mime, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

// ---------- 백업 ----------
export async function exportProject(id) {
  const { row, assets } = await inTx(['projects', 'assets'], 'readonly', async (tx) => {
    const r = await wrap(tx.objectStore('projects').get(String(id)));
    if (!r) fail('작업을 찾을 수 없습니다.', 404, 'NOT_FOUND');
    const a = await wrap(tx.objectStore('assets').index('projectId').getAll(r.id));
    return { row: r, assets: a };
  });
  assets.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const stateText = JSON.stringify(row.state);
  const rawTotal = assets.reduce((s, a) => s + a.size, 0);
  if (Math.ceil(rawTotal / 3) * 4 + byteLen(stateText) + 64 * KiB > LIMITS.backupBytesMax) {
    fail('백업 파일이 50MiB를 초과하여 만들 수 없습니다. 이미지 수를 줄인 뒤 다시 시도해 주세요.', 413, 'BACKUP_TOO_LARGE');
  }
  const parts = [`{"format":"personal-studio-backup","version":1,"project":{"title":${JSON.stringify(row.title)},"description":${JSON.stringify(row.description)},"type":${JSON.stringify(row.type)},"state":${stateText}},"assets":[`];
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const data = bytesToBase64(new Uint8Array(await a.blob.arrayBuffer()));
    parts.push(`${i ? ',' : ''}{"id":${JSON.stringify(a.id)},"name":${JSON.stringify(a.name)},"mime":${JSON.stringify(a.mime)},"data":"${data}"}`);
  }
  parts.push(']}');
  return new Response(new Blob(parts, { type: 'application/json' }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

const scalarRefKey = (k) => k === 'assetId' || k.endsWith('AssetId');
const listRefKey = (k) => k === 'refIds' || k === 'assetIds' || k.endsWith('AssetIds');

function remapFeature(value, map, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return;
  for (const key of Object.keys(value)) {
    if (scalarRefKey(key) && (typeof value[key] === 'string' || value[key] === null)) value[key] = value[key] ? (map(value[key]) ?? null) : null;
    else if (listRefKey(key) && Array.isArray(value[key])) value[key] = value[key].map((x) => (typeof x === 'string' ? map(x) : null)).filter(Boolean);
    else remapFeature(value[key], map, depth + 1);
  }
}

/** 상태 안의 모든 이미지 id를 map(oldId)->newId|undefined 로 바꾼다. */
export function remapAssetRefs(state, map) {
  const ed = state.editor;
  if (typeof ed.baseAssetId === 'string') ed.baseAssetId = map(ed.baseAssetId) ?? null;
  else ed.baseAssetId = null;
  ed.imageLayers = (Array.isArray(ed.imageLayers) ? ed.imageLayers : []).map((l) => ({ ...l, assetId: typeof l?.assetId === 'string' ? (map(l.assetId) ?? null) : null })).filter((l) => l.assetId);
  for (const c of Array.isArray(state.story.characters) ? state.story.characters : []) if (c && c.assetId) c.assetId = map(c.assetId) ?? null;
  for (const s of Array.isArray(state.story.scenes) ? state.story.scenes : []) if (s && s.assetId) s.assetId = map(s.assetId) ?? null;
  const dp = state.detailPage;
  dp.productAssetIds = (Array.isArray(dp.productAssetIds) ? dp.productAssetIds : []).map((x) => (typeof x === 'string' ? map(x) : null)).filter(Boolean);
  if (dp.modelAssetId) dp.modelAssetId = map(dp.modelAssetId) ?? null;
  if (dp.plan && Array.isArray(dp.plan.sections)) for (const s of dp.plan.sections) if (s && s.assetId) s.assetId = map(s.assetId) ?? null;
  remapFeature(state.featureStudio, map);
  return state;
}

function mergeDefaults(input) {
  const d = defaultState();
  const out = { ...d, ...input };
  for (const k of ['story', 'editor', 'promptLab', 'detailPage']) out[k] = { ...d[k], ...(isPlain(input[k]) ? input[k] : {}) };
  if (!isPlain(out.featureStudio)) out.featureStudio = {};
  return out;
}

export async function importBackup(jsonText) {
  let body;
  try { body = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText; } catch { fail('JSON 형식이 아닙니다. 나의 창작실에서 내보낸 백업 파일인지 확인해 주세요.'); }
  if (!isPlain(body) || body.format !== 'personal-studio-backup') fail('나의 창작실 백업 파일 형식이 아닙니다.');
  if (body.version !== 1) fail('지원하지 않는 백업 버전입니다.');
  const extra = Object.keys(body).filter((k) => !['format', 'version', 'project', 'assets'].includes(k));
  if (extra.length) fail(`백업에 알 수 없는 항목 '${extra[0].slice(0, 40)}'이(가) 있습니다.`);
  const p = body.project;
  if (!isPlain(p)) fail('백업에 작업 정보가 없습니다.');
  const pExtra = Object.keys(p).filter((k) => !['title', 'description', 'type', 'state'].includes(k));
  if (pExtra.length) fail(`백업 작업 정보에 알 수 없는 항목 '${pExtra[0].slice(0, 40)}'이(가) 있습니다.`);
  const title = validateTitle(p.title);
  const description = p.description === undefined ? '' : validateDescription(p.description);
  const type = p.type === undefined ? 'other' : validateType(p.type);
  const state = mergeDefaults(validateState(p.state === undefined ? {} : p.state));

  const list = body.assets === undefined ? [] : body.assets;
  if (!Array.isArray(list)) fail('백업의 이미지 목록은 배열이어야 합니다.');
  if (list.length > LIMITS.assetsPerProjectMax) fail(`백업 이미지는 최대 ${LIMITS.assetsPerProjectMax}개까지 가져올 수 있습니다.`);
  const seen = new Set();
  let total = 0;
  const decoded = list.map((a, i) => {
    const label = `백업 이미지 ${i + 1}`;
    if (!isPlain(a)) fail(`${label} 정보가 올바르지 않습니다.`);
    const aExtra = Object.keys(a).filter((k) => !['id', 'name', 'mime', 'data'].includes(k));
    if (aExtra.length) fail(`${label}에 알 수 없는 항목 '${aExtra[0].slice(0, 40)}'이(가) 있습니다.`);
    if (typeof a.id !== 'string' || !a.id || a.id.length > LIMITS.idMax) fail(`${label}의 id가 올바르지 않습니다.`);
    if (seen.has(a.id)) fail(`${label}의 id가 중복되었습니다.`);
    seen.add(a.id);
    const img = validateImage({ name: a.name, mime: a.mime, bytes: base64ToBytes(a.data, `${label} 데이터`) }, label);
    total += img.bytes.length;
    if (total > LIMITS.backupBytesMax) fail('백업 이미지 전체 크기가 50MiB를 초과합니다.', 413, 'BACKUP_TOO_LARGE');
    return { oldId: a.id, ...img };
  });

  const idMap = new Map(decoded.map((d) => [d.oldId, crypto.randomUUID()]));
  remapAssetRefs(state, (old) => idMap.get(old)); // 백업에 없는 이미지 참조는 비워 둔다(오류 대신 정리).

  const ts = nowIso();
  const row = { id: crypto.randomUUID(), title, description, type, version: 1, state, createdAt: ts, updatedAt: ts };
  const assetRows = decoded.map((d) => ({
    id: idMap.get(d.oldId), projectId: row.id, name: d.name, mime: d.mime, size: d.bytes.length,
    blob: new Blob([d.bytes], { type: d.mime }), createdAt: ts, seq: nextSeq(),
  }));
  await inTx(['projects', 'assets'], 'readwrite', async (tx) => {
    const projects = tx.objectStore('projects');
    if ((await wrap(projects.count())) >= LIMITS.projectsMax) fail(`작업은 최대 ${LIMITS.projectsMax}개까지 만들 수 있습니다.`, 409, 'PROJECT_LIMIT');
    projects.add(row);
    const assets = tx.objectStore('assets');
    for (const r of assetRows) assets.add(r);
  });
  for (const r of assetRows) ensureUrl(r);
  return { project: projectJson(row, true, assetRows.length) };
}
