// 브라우저에서 AI 제공자(Google Gemini, OpenAI)를 직접 호출하는 클라이언트.
// SDK 없음, 자동 재시도 없음. 키는 이 브라우저의 별도 설정 DB(personal-studio-settings)에만 저장하며
// 작업 DB와 분리되어 작업 백업에는 절대 들어가지 않는다. 키를 로그·URL·오류 메시지에 남기지 않는다.
// 의존성(fetch, 저장소, 자료 접근, 시계)은 createAiClient 로 주입할 수 있다(테스트용).

import { qualitiesFor } from './model-catalog.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_BASE = 'https://api.openai.com/v1';
const MiB = 1024 * 1024;
const TIMEOUT_MS = 180000;
const DEFAULTS = Object.freeze({
  geminiModel: 'gemini-2.5-flash', imageModel: 'gpt-image-1', quality: 'low', dailyImageLimit: 10, dailyTextLimit: 30,
});
const SESSION_KEY = 'personal-studio-session-keys';
const KEY_NAMES = ['geminiKey', 'openaiKey'];
const SECRET_RE = /(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,})/g;

function seoulDate(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);
}

export function bytesToBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class LocalAiError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}

// ---- 기본 저장소(브라우저) -------------------------------------------------
export function createMemoryStorage() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async set(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { m.delete(k); },
    async clear() { m.clear(); },
  };
}

function createIdbStorage(dbName = 'personal-studio-settings') {
  let dbp = null;
  const open = () => (dbp ||= new Promise((resolve, reject) => {
    const q = indexedDB.open(dbName, 1);
    q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains('kv')) q.result.createObjectStore('kv'); };
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => { dbp = null; reject(q.error); };
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)),
    delete: (k) => run('readwrite', (s) => s.delete(k)),
    clear: () => run('readwrite', (s) => s.clear()),
  };
}

function createWebSessionStorage() {
  const mem = createMemoryStorage();
  const ok = () => { try { return typeof sessionStorage !== 'undefined' && !!sessionStorage; } catch { return false; } };
  return {
    async get(k) { if (!ok()) return mem.get(k); try { const t = sessionStorage.getItem(k); return t ? JSON.parse(t) : undefined; } catch { return undefined; } },
    async set(k, v) { if (!ok()) return mem.set(k, v); sessionStorage.setItem(k, JSON.stringify(v)); },
    async delete(k) { if (!ok()) return mem.delete(k); sessionStorage.removeItem(k); },
    async clear() { if (!ok()) return mem.clear(); sessionStorage.removeItem(SESSION_KEY); },
  };
}

function defaultStorage() {
  const persistent = (typeof indexedDB !== 'undefined') ? createIdbStorage() : createMemoryStorage();
  return Object.assign(persistent, { session: createWebSessionStorage() });
}

function defaultAssets() {
  return {
    getAssetForAi: (id) => import('./local-db.js').then((m) => m.getAssetForAi(id)),
    addAssetFromBytes: (projectId, name, mime, bytes) => import('./local-db.js').then((m) => m.addAssetFromBytes(projectId, name, mime, bytes)),
  };
}

// ---- 클라이언트 -------------------------------------------------------------
export function createAiClient({ fetchImpl, storage, assets, now, errorClass } = {}) {
  const store = storage || defaultStorage();
  const sessionStore = store.session || createMemoryStorage();
  const assetApi = assets || defaultAssets();
  const clock = now || (() => new Date());
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  let ErrCls = errorClass || null;
  let busy = false;

  async function ensureErrorClass() {
    if (ErrCls) return;
    try { ErrCls = (await import('./api.js')).ApiError || LocalAiError; } catch { ErrCls = LocalAiError; }
  }

  let knownKeys = [];
  function redact(text) {
    let t = String(text ?? '');
    for (const k of knownKeys) if (k && k.length >= 8) t = t.split(k).join('[비밀 값 숨김]');
    return t.replace(SECRET_RE, '[비밀 값 숨김]');
  }
  function fail(message, code = 'AI_VALIDATION', status = 400) {
    throw new (ErrCls || LocalAiError)(redact(message), status, code);
  }

  // ---- 저장소 읽기/쓰기 ----
  async function io(fn) {
    try { return await fn(); } catch (e) {
      if (e && ((ErrCls && e instanceof ErrCls) || e.name === 'ApiError')) throw e;
      fail('이 브라우저에서 AI 설정을 저장하거나 읽을 수 없습니다. 사생활 보호 모드나 저장소 차단 설정을 확인해 주세요.', 'AI_STORAGE', 500);
    }
  }
  async function loadAll() {
    return io(async () => {
      const [settings, keys, sess, usage] = await Promise.all([store.get('settings'), store.get('keys'), sessionStore.get(SESSION_KEY), store.get('usage')]);
      const all = {
        settings: { ...DEFAULTS, ...(settings || {}) },
        persistKeys: { ...(keys || {}) },
        sessionKeys: { ...(sess || {}) },
        usage,
      };
      knownKeys = [...Object.values(all.persistKeys), ...Object.values(all.sessionKeys)].filter((v) => typeof v === 'string');
      return all;
    });
  }
  function usageFor(all) {
    const today = seoulDate(clock());
    const u = all.usage;
    if (!u || u.date !== today) return { date: today, images: 0, text: 0 };
    return { date: u.date, images: Number(u.images) || 0, text: Number(u.text) || 0 };
  }
  const keyOf = (all, provider) => (all.persistKeys[provider + 'Key'] || all.sessionKeys[provider + 'Key'] || '');
  const sourceOf = (all, provider) => (all.persistKeys[provider + 'Key'] ? 'saved' : all.sessionKeys[provider + 'Key'] ? 'session' : null);

  function statusOf(all) {
    const { rememberKeys, ...rest } = all.settings;
    const u = usageFor(all);
    return {
      ...rest,
      rememberKeys: rememberKeys !== false,
      geminiConfigured: Boolean(keyOf(all, 'gemini')),
      openaiConfigured: Boolean(keyOf(all, 'openai')),
      geminiSource: sourceOf(all, 'gemini'),
      openaiSource: sourceOf(all, 'openai'),
      usage: { images: u.images, text: u.text, date: u.date },
      usageNote: '한국시간 기준 이 브라우저의 시도 횟수이며 실패도 포함합니다. 실제 금액 한도는 AI 제공자에서 별도로 설정하세요.',
    };
  }

  // ---- 설정 ----
  async function aiConfig() { return statusOf(await loadAll()); }
  async function isConfigured() {
    const s = await aiConfig();
    return s.geminiConfigured || s.openaiConfigured;
  }

  async function aiSaveConfig(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) fail('AI 설정 형식이 올바르지 않습니다.');
    if (busy) fail('AI 작업 중에는 설정을 바꿀 수 없습니다.', 'AI_BUSY', 409);
    const allowed = ['geminiKey', 'openaiKey', 'removeGemini', 'removeOpenai', 'rememberKeys', ...Object.keys(DEFAULTS)];
    if (Object.keys(b).some((k) => !allowed.includes(k))) fail('알 수 없는 AI 설정입니다.');
    const all = await loadAll();
    const settings = { ...all.settings };
    const pKeys = { ...all.persistKeys };
    const sKeys = { ...all.sessionKeys };
    if (b.rememberKeys !== undefined && typeof b.rememberKeys !== 'boolean') fail('키 기억 설정은 참/거짓이어야 합니다.');
    const remember = b.rememberKeys !== undefined ? b.rememberKeys : settings.rememberKeys !== false;
    for (const p of ['gemini', 'openai']) {
      const name = p + 'Key';
      const v = b[name];
      if (v !== undefined && (typeof v !== 'string' || v.length > 512 || /[\s\x00-\x1f]/.test(v))) fail('API 키 형식을 확인해 주세요.');
      if (v) { pKeys[name] = v; delete sKeys[name]; }
      if (b['remove' + (p === 'gemini' ? 'Gemini' : 'Openai')] === true) { delete pKeys[name]; delete sKeys[name]; }
    }
    // 저장 위치를 선택에 맞춘다: 기억 켜면 영구 저장, 끄면 이 탭 세션에만 둔다.
    if (remember) { Object.assign(pKeys, sKeys); for (const n of KEY_NAMES) delete sKeys[n]; }
    else { Object.assign(sKeys, pKeys); for (const n of KEY_NAMES) delete pKeys[n]; }
    for (const k of ['geminiModel', 'imageModel']) {
      if (b[k] !== undefined) {
        if (typeof b[k] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(b[k])) fail('모델 이름 형식이 올바르지 않습니다.');
        if (k === 'imageModel' && !/^(gpt-image-|chatgpt-image-)/.test(b[k])) fail('GPT 이미지 모델을 선택해 주세요.');
        settings[k] = b[k];
      }
    }
    if (b.quality !== undefined) {
      // 기본 품질은 (새로 고른) 기본 이미지 모델이 지원하는 값이어야 한다. xhigh·max 는 2.5 계열만 지원한다.
      if (typeof b.quality !== 'string' || !qualitiesFor(settings.imageModel).includes(b.quality)) fail('이미지 품질을 확인해 주세요.');
      settings.quality = b.quality;
    }
    for (const k of ['dailyImageLimit', 'dailyTextLimit']) {
      if (b[k] !== undefined) {
        if (!Number.isInteger(b[k]) || b[k] < 0 || b[k] > 1000) fail('일일 한도는 0~1000 정수로 입력해 주세요.');
        settings[k] = b[k];
      }
    }
    settings.rememberKeys = remember;
    await io(async () => {
      await store.set('settings', settings);
      if (Object.keys(pKeys).length) await store.set('keys', pKeys); else await store.delete('keys');
      if (Object.keys(sKeys).length) await sessionStore.set(SESSION_KEY, sKeys); else await sessionStore.delete(SESSION_KEY);
    });
    return aiConfig();
  }

  async function clearAllAiData() {
    if (busy) fail('AI 작업 중에는 지울 수 없습니다.', 'AI_BUSY', 409);
    await io(async () => { await store.clear(); await sessionStore.delete(SESSION_KEY); await sessionStore.clear?.(); });
    knownKeys = [];
  }

  // ---- 제공자 호출 ----
  async function readLimited(r, max) {
    if (!r.body || typeof r.body.getReader !== 'function') {
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > max) fail('AI 응답이 너무 큽니다.', 'AI_RESPONSE_LIMIT', 502);
      return buf;
    }
    const reader = r.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) { await reader.cancel(); fail('AI 응답이 너무 큽니다.', 'AI_RESPONSE_LIMIT', 502); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  async function remote(url, init, max = 32 * MiB) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const r = await doFetch(url, { ...init, signal: controller.signal, redirect: 'error' });
      if (!r.ok) {
        // 제공자 오류 본문에는 키나 입력 문구가 섞일 수 있으므로 절대 그대로 보이지 않는다.
        try { await r.body?.cancel(); } catch { /* ignore */ }
        const messages = { 400: '모델·입력 형식을 확인해 주세요.', 401: 'API 키 인증에 실패했습니다.', 403: '모델 사용 권한을 확인해 주세요.', 404: '해당 모델을 찾을 수 없습니다.', 429: '요청 한도 또는 API 결제 상태를 확인해 주세요.' };
        fail(`AI 제공자 HTTP ${r.status}: ${messages[r.status] || '제공자 오류입니다. 잠시 후 직접 재시도해 주세요.'}`, 'AI_PROVIDER_ERROR', 502);
      }
      if (Number(r.headers?.get?.('content-length')) > max) { try { await r.body?.cancel(); } catch { /* ignore */ } fail('AI 응답이 너무 큽니다.', 'AI_RESPONSE_LIMIT', 502); }
      const bytes = await readLimited(r, max);
      try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('AI 응답 형식을 읽을 수 없습니다.', 'AI_BAD_RESPONSE', 502); }
    } catch (e) {
      if (e && e.name === 'ApiError') throw e;
      if (ErrCls && e instanceof ErrCls) throw e;
      fail('AI 연결이 끊겼거나 응답 시간이 초과되었습니다. 중복 과금 방지를 위해 자동 재시도하지 않았습니다.', 'AI_NETWORK', 502);
    } finally { clearTimeout(timer); }
  }
  function authHeaders(all, provider) {
    const k = keyOf(all, provider);
    if (!k) fail('AI 키가 없습니다. AI 연결 설정을 먼저 해 주세요.', 'AI_NOT_CONFIGURED', 501);
    return provider === 'gemini' ? { 'x-goog-api-key': k } : { Authorization: `Bearer ${k}` };
  }
  function validatePrompt(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 60000) fail('요청문은 1~60000자로 입력해 주세요.');
  }

  async function aiTest(provider) {
    if (!['gemini', 'openai'].includes(provider)) fail('제공자를 선택해 주세요.');
    const all = await loadAll();
    const h = authHeaders(all, provider);
    const j = await remote(provider === 'gemini' ? `${GEMINI_BASE}/models?pageSize=1000` : `${OPENAI_BASE}/models`, { headers: h }, 4 * MiB);
    const models = provider === 'gemini'
      ? (j.models || []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''))
      : (j.data || []).map((m) => m.id).filter((n) => /^(gpt-image-|chatgpt-image-)/.test(n));
    return { models, message: '키 조회 성공. 실제 생성 권한·결제 가능 여부는 생성 호출 때 확인됩니다.' };
  }

  async function run(kind, all, fn) {
    if (busy) fail('다른 AI 요청이 처리 중입니다.', 'AI_BUSY', 409);
    const limit = kind === 'images' ? all.settings.dailyImageLimit : all.settings.dailyTextLimit;
    const usage = usageFor(all);
    if (usage[kind] >= limit) fail('오늘의 AI 요청 한도에 도달했습니다. AI 설정에서 확인해 주세요.', 'AI_DAILY_LIMIT', 429);
    busy = true;
    try {
      usage[kind]++;
      await io(() => store.set('usage', usage)); // 요청 전에 먼저 기록해 실패한 시도도 센다.
      const result = await fn();
      const now2 = usageFor({ usage });
      return { ...result, usage: { images: now2.images, text: now2.text, date: now2.date } };
    } finally { busy = false; }
  }

  async function loadRefs(projectId, assetIds, isImage) {
    const ids = assetIds ?? [];
    if (!Array.isArray(ids) || ids.length > (isImage ? 4 : 8) || new Set(ids).size !== ids.length) fail('참조 이미지 수 또는 형식을 확인해 주세요.');
    const refs = [];
    let total = 0;
    for (const id of ids) {
      const a = typeof id === 'string' ? await assetApi.getAssetForAi(id) : null;
      if (!a || a.projectId !== projectId) fail('이 작업의 참조 이미지를 찾을 수 없습니다.', 'NOT_FOUND', 404);
      total += a.bytes.length;
      if (total > (isImage ? 20 : 8) * MiB) fail('참조 이미지 용량을 줄여 주세요.', 'PAYLOAD_TOO_LARGE', 413);
      refs.push({ mime: a.mime, bytes: a.bytes });
    }
    return refs;
  }

  async function aiGemini({ projectId, prompt, assetIds, json } = {}) {
    if (typeof projectId !== 'string' || !projectId) fail('먼저 작업을 열어 주세요.');
    if (json !== undefined && typeof json !== 'boolean') fail('json은 참/거짓이어야 합니다.');
    validatePrompt(prompt);
    const all = await loadAll();
    const h = authHeaders(all, 'gemini');
    const refs = await loadRefs(projectId, assetIds, false);
    return run('text', all, async () => {
      const parts = [{ text: prompt }, ...refs.map((r) => ({ inline_data: { mime_type: r.mime, data: bytesToBase64(r.bytes) } }))];
      const j = await remote(`${GEMINI_BASE}/models/${encodeURIComponent(all.settings.geminiModel)}:generateContent`, {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.6, maxOutputTokens: 16384, ...(json ? { responseMimeType: 'application/json' } : {}) } }),
      });
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
      if (!text) fail('AI 응답이 비어 있거나 안전 정책으로 차단되었습니다.', 'AI_EMPTY', 502);
      if (!json) return { text };
      try { return { text, json: JSON.parse(text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')) }; }
      catch { fail('AI가 올바른 JSON을 반환하지 않았습니다. 입력을 줄여 다시 시도해 주세요.', 'AI_BAD_JSON', 502); }
    });
  }

  // model·quality 를 호출마다 고를 수 있다. 검증에 실패하면 제공자 호출도, 일일 한도 사용도 없다.
  async function aiImage({ projectId, prompt, assetIds, size = '1024x1024', quality, model } = {}) {
    if (typeof projectId !== 'string' || !projectId) fail('먼저 작업을 열어 주세요.');
    validatePrompt(prompt);
    const all = await loadAll();
    const h = authHeaders(all, 'openai');
    if (!['1024x1024', '1536x1024', '1024x1536'].includes(size)) fail('지원하지 않는 이미지 크기입니다.');
    const useModel = model ?? all.settings.imageModel;
    if (typeof useModel !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(useModel)) fail('모델 이름 형식이 올바르지 않습니다.');
    if (!/^(gpt-image-|chatgpt-image-)/.test(useModel)) fail('GPT 이미지 모델을 선택해 주세요.');
    const allowed = qualitiesFor(useModel);
    // 호출에서 품질을 정하지 않았고 저장된 기본 품질을 이 모델이 지원하지 않으면 가장 싼 low 로 내려 보낸다.
    const q = quality ?? (allowed.includes(all.settings.quality) ? all.settings.quality : 'low');
    if (typeof q !== 'string' || !allowed.includes(q)) fail('품질 설정이 올바르지 않습니다.');
    const refs = await loadRefs(projectId, assetIds, true);
    const generated = await run('images', all, async () => {
      let body; let url; const headers = { ...h };
      if (refs.length) {
        url = `${OPENAI_BASE}/images/edits`; body = new FormData();
        for (const [k, v] of Object.entries({ model: useModel, prompt, size, quality: q, n: '1', output_format: 'png' })) body.append(k, v);
        refs.forEach((r, i) => body.append('image[]', new Blob([r.bytes], { type: r.mime }), `reference-${i}.${String(r.mime).split('/')[1]}`));
      } else {
        url = `${OPENAI_BASE}/images/generations`; headers['Content-Type'] = 'application/json';
        body = JSON.stringify({ model: useModel, prompt, size, quality: q, n: 1, output_format: 'png' });
      }
      const j = await remote(url, { method: 'POST', headers, body });
      const b64 = j.data?.[0]?.b64_json;
      if (typeof b64 !== 'string' || !b64.length || b64.length > 28 * MiB || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) fail('지원하는 이미지 응답이 없습니다.', 'AI_BAD_IMAGE', 502);
      let bytes;
      try { bytes = base64ToBytes(b64); } catch { fail('지원하는 이미지 응답이 없습니다.', 'AI_BAD_IMAGE', 502); }
      if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) fail('지원하는 이미지 응답이 없습니다.', 'AI_BAD_IMAGE', 502);
      return { bytes };
    });
    const asset = await assetApi.addAssetFromBytes(projectId, 'AI 생성 이미지.png', 'image/png', generated.bytes);
    return { asset, usage: generated.usage, model: useModel, quality: q };
  }

  // 모든 공개 함수는 첫 호출 때 ApiError 클래스를 읽어 오고, 오류 메시지에서 키를 한 번 더 지운다.
  const wrap = (fn) => async (...args) => {
    await ensureErrorClass();
    try { return await fn(...args); } catch (e) {
      if (e && typeof e.message === 'string') {
        const clean = redact(e.message);
        if (clean !== e.message) { try { e.message = clean; } catch { /* ignore */ } }
      }
      throw e;
    }
  };
  return {
    isConfigured: wrap(isConfigured), aiConfig: wrap(aiConfig), aiSaveConfig: wrap(aiSaveConfig), aiTest: wrap(aiTest),
    aiGemini: wrap(aiGemini), aiImage: wrap(aiImage), clearAllAiData: wrap(clearAllAiData),
  };
}

const defaultClient = createAiClient();
export const isConfigured = (...a) => defaultClient.isConfigured(...a);
export const aiConfig = (...a) => defaultClient.aiConfig(...a);
export const aiSaveConfig = (...a) => defaultClient.aiSaveConfig(...a);
export const aiTest = (...a) => defaultClient.aiTest(...a);
export const aiGemini = (...a) => defaultClient.aiGemini(...a);
export const aiImage = (...a) => defaultClient.aiImage(...a);
export const clearAllAiData = (...a) => defaultClient.clearAllAiData(...a);
