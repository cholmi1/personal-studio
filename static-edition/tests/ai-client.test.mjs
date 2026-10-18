// node --test tests/ai-client.test.mjs : 가짜 fetch·저장소·자료함으로 ai-client.js 를 검증한다. 실제 네트워크 호출 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiClient, createMemoryStorage, bytesToBase64 } from '../public/ai-client.js';

class TestApiError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}
const GKEY = 'AIzaFAKEKEYFORTESTING1234567890abcd';
const OKEY = 'sk-FAKEOPENAIKEYFORTESTING1234567890';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function setup({ fetchImpl, now } = {}) {
  const storage = Object.assign(createMemoryStorage(), { session: createMemoryStorage() });
  const files = new Map();
  const added = [];
  const calls = [];
  const assets = {
    getAssetForAi: async (id) => files.get(id) || null,
    addAssetFromBytes: async (projectId, name, mime, bytes) => { const a = { id: 'new-' + (added.length + 1), projectId, name, mime, size: bytes.length }; added.push({ ...a, bytes }); return a; },
  };
  const clock = now || (() => new Date('2026-10-18T03:00:00Z'));
  const f = fetchImpl || (async (url, init) => { calls.push({ url, init }); return json({}); });
  const wrapped = async (url, init) => { if (!fetchImpl) return f(url, init); calls.push({ url, init }); return fetchImpl(url, init); };
  const client = createAiClient({ fetchImpl: wrapped, storage, assets, now: clock, errorClass: TestApiError });
  return { client, storage, files, added, calls };
}
const addFile = (files, id, projectId, bytes = new Uint8Array([1, 2, 3]), mime = 'image/png') => files.set(id, { id, projectId, mime, name: id + '.png', bytes });
async function withKeys(s, extra = {}) { return s.client.aiSaveConfig({ geminiKey: GKEY, openaiKey: OKEY, ...extra }); }

test('Gemini 요청 형태: URL, 키 헤더, 본문, 참조 이미지, JSON 모드', async () => {
  const s = setup({ fetchImpl: async () => json({ candidates: [{ content: { parts: [{ text: '```json\n{"a":1}\n```' }] } }] }) });
  await withKeys(s);
  addFile(s.files, 'a1', 'p1', new Uint8Array([9, 8, 7]), 'image/jpeg');
  const r = await s.client.aiGemini({ projectId: 'p1', prompt: '안녕', assetIds: ['a1'], json: true });
  assert.deepEqual(r.json, { a: 1 });
  assert.equal(r.usage.text, 1);
  const c = s.calls[0];
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['x-goog-api-key'], GKEY);
  assert.equal(c.init.redirect, 'error');
  assert.ok(c.init.signal);
  assert.ok(!c.url.includes(GKEY));
  const body = JSON.parse(c.init.body);
  assert.deepEqual(body.contents[0].parts[0], { text: '안녕' });
  assert.deepEqual(body.contents[0].parts[1], { inline_data: { mime_type: 'image/jpeg', data: bytesToBase64(new Uint8Array([9, 8, 7])) } });
  assert.equal(body.generationConfig.temperature, 0.6);
  assert.equal(body.generationConfig.maxOutputTokens, 16384);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('Gemini 텍스트 모드는 responseMimeType 없음, 빈 응답은 오류', async () => {
  let n = 0;
  const s = setup({ fetchImpl: async () => (++n === 1 ? json({ candidates: [{ content: { parts: [{ text: '답' }] } }] }) : json({ candidates: [] })) });
  await withKeys(s);
  const r = await s.client.aiGemini({ projectId: 'p1', prompt: 'x' });
  assert.equal(r.text, '답');
  assert.equal('responseMimeType' in JSON.parse(s.calls[0].init.body).generationConfig, false);
  await assert.rejects(() => s.client.aiGemini({ projectId: 'p1', prompt: 'x' }), (e) => e.code === 'AI_EMPTY');
});

test('OpenAI 이미지 생성: JSON 본문, Bearer, 결과 자료 저장', async () => {
  const s = setup({ fetchImpl: async () => json({ data: [{ b64_json: bytesToBase64(PNG) }] }) });
  await withKeys(s);
  const r = await s.client.aiImage({ projectId: 'p1', prompt: '숲', size: '1536x1024' });
  const c = s.calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(c.init.headers.Authorization, `Bearer ${OKEY}`);
  assert.equal(c.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(c.init.body), { model: 'gpt-image-1', prompt: '숲', size: '1536x1024', quality: 'low', n: 1, output_format: 'png' });
  assert.equal(r.asset.name, 'AI 생성 이미지.png');
  assert.equal(r.asset.mime, 'image/png');
  assert.deepEqual([...s.added[0].bytes], [...PNG]);
  assert.equal(r.usage.images, 1);
});

test('OpenAI 참조 편집: FormData image[] 와 필드', async () => {
  const s = setup({ fetchImpl: async () => json({ data: [{ b64_json: bytesToBase64(PNG) }] }) });
  await withKeys(s);
  addFile(s.files, 'a1', 'p1'); addFile(s.files, 'a2', 'p1', new Uint8Array([4, 5]), 'image/webp');
  await s.client.aiImage({ projectId: 'p1', prompt: '합성', assetIds: ['a1', 'a2'], size: '1024x1536', quality: 'high' });
  const c = s.calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/images/edits');
  assert.equal(c.init.headers.Authorization, `Bearer ${OKEY}`);
  assert.equal('Content-Type' in c.init.headers, false); // FormData 경계는 브라우저가 붙인다
  assert.ok(c.init.body instanceof FormData);
  const fd = c.init.body;
  assert.equal(fd.get('model'), 'gpt-image-1');
  assert.equal(fd.get('prompt'), '합성');
  assert.equal(fd.get('size'), '1024x1536');
  assert.equal(fd.get('quality'), 'high');
  assert.equal(fd.get('n'), '1');
  assert.equal(fd.get('output_format'), 'png');
  const imgs = fd.getAll('image[]');
  assert.equal(imgs.length, 2);
  assert.equal(imgs[0].type, 'image/png');
  assert.equal(imgs[1].type, 'image/webp');
  assert.equal(imgs[0].name, 'reference-0.png');
});

test('참조 이미지 검사: 다른 작업, 중복, 개수, 용량', async () => {
  const s = setup({ fetchImpl: async () => json({ data: [{ b64_json: bytesToBase64(PNG) }] }) });
  await withKeys(s);
  addFile(s.files, 'a1', 'p1'); addFile(s.files, 'other', 'p2');
  for (const n of [3, 4, 5]) addFile(s.files, 'x' + n, 'p1');
  addFile(s.files, 'big1', 'p1', new Uint8Array(11 * 1024 * 1024)); addFile(s.files, 'big2', 'p1', new Uint8Array(11 * 1024 * 1024));
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'x', assetIds: ['other'] }), (e) => e.status === 404);
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'x', assetIds: ['a1', 'a1'] }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'x', assetIds: ['a1', 'x3', 'x4', 'x5', 'other'] }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'x', assetIds: ['big1', 'big2'] }), (e) => e.status === 413);
  assert.equal(s.calls.length, 0);
  assert.equal((await s.client.aiConfig()).usage.images, 0); // 검증 실패는 한도를 쓰지 않는다
});

test('입력 검증: 프롬프트·크기·품질은 제공자 호출과 한도 사용 전에 거부', async () => {
  const s = setup();
  await withKeys(s);
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: '  ' }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'x', size: '999x999' }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'x', quality: 'ultra' }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiGemini({ projectId: 'p1', prompt: 'x'.repeat(60001) }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiGemini({ projectId: 'p1', prompt: 'x', json: 'yes' }), (e) => e.code === 'AI_VALIDATION');
  assert.equal(s.calls.length, 0);
  const cfg = await s.client.aiConfig();
  assert.equal(cfg.usage.images + cfg.usage.text, 0);
});

test('키가 없으면 501 AI_NOT_CONFIGURED, 문구에 서버 언급 없음', async () => {
  const s = setup();
  await assert.rejects(() => s.client.aiGemini({ projectId: 'p1', prompt: 'x' }), (e) => e.status === 501 && e.code === 'AI_NOT_CONFIGURED' && !/서버|STUDIO_SECRET/.test(e.message));
  assert.equal(await s.client.isConfigured(), false);
  await s.client.aiSaveConfig({ openaiKey: OKEY });
  assert.equal(await s.client.isConfigured(), true);
});

test('일일 한도: 설정값 도달 시 429, 실패한 제공자 호출도 횟수에 포함, 날짜(서울) 바뀌면 초기화', async () => {
  let t = new Date('2026-10-18T14:00:00Z'); // 서울 23:00
  let mode = 'fail';
  const s = setup({ now: () => t, fetchImpl: async () => (mode === 'fail' ? new Response('{"error":"nope"}', { status: 500 }) : json({ data: [{ b64_json: bytesToBase64(PNG) }] })) });
  await withKeys(s, { dailyImageLimit: 2 });
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'a' }), (e) => e.code === 'AI_PROVIDER_ERROR');
  mode = 'ok';
  await s.client.aiImage({ projectId: 'p1', prompt: 'b' });
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'c' }), (e) => e.status === 429 && e.code === 'AI_DAILY_LIMIT');
  assert.equal(s.calls.length, 2);
  assert.equal((await s.client.aiConfig()).usage.images, 2);
  t = new Date('2026-10-18T15:30:00Z'); // 서울 다음 날 00:30
  assert.equal((await s.client.aiConfig()).usage.images, 0);
  await s.client.aiImage({ projectId: 'p1', prompt: 'd' });
  assert.equal((await s.client.aiConfig()).usage.images, 1);
});

test('기본 한도는 이미지 10 / 텍스트 30', async () => {
  const s = setup();
  const cfg = await s.client.aiConfig();
  assert.equal(cfg.dailyImageLimit, 10);
  assert.equal(cfg.dailyTextLimit, 30);
  assert.equal(cfg.geminiModel, 'gemini-2.5-flash');
  assert.equal(cfg.imageModel, 'gpt-image-1');
  assert.equal(cfg.quality, 'low');
});

test('동시 실행 잠금: 진행 중에는 두 번째 요청과 설정 변경을 거부', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = setup({ fetchImpl: async () => { await gate; return json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }); } });
  await withKeys(s);
  const first = s.client.aiGemini({ projectId: 'p1', prompt: '1' });
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(() => s.client.aiGemini({ projectId: 'p1', prompt: '2' }), (e) => e.status === 409 && e.code === 'AI_BUSY');
  await assert.rejects(() => s.client.aiSaveConfig({ quality: 'high' }), (e) => e.status === 409 && e.code === 'AI_BUSY');
  release();
  assert.equal((await first).text, 'ok');
  await s.client.aiSaveConfig({ quality: 'high' });
  assert.equal((await s.client.aiConfig()).quality, 'high');
});

test('잘못된 base64·이미지가 아닌 응답은 저장하지 않고 거부', async () => {
  const bodies = [{ data: [{ b64_json: '###not base64###' }] }, { data: [{ b64_json: bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])) }] }, { data: [{ b64_json: '' }] }, { data: [] }];
  let i = 0;
  const s = setup({ fetchImpl: async () => json(bodies[i++]) });
  await withKeys(s, { dailyImageLimit: 10 });
  for (let n = 0; n < bodies.length; n++) {
    await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'x' }), (e) => e.code === 'AI_BAD_IMAGE' && e.status === 502);
  }
  assert.equal(s.added.length, 0);
  assert.equal((await s.client.aiConfig()).usage.images, 4);
});

test('오류에서 키 숨김: 제공자 본문 미노출, 자료 저장소 오류 메시지의 키도 제거', async () => {
  let mode = 'provider';
  const s = setup({ fetchImpl: async () => { if (mode === 'ok') return json({ data: [{ b64_json: bytesToBase64(PNG) }] }); return new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${OKEY}` } }), { status: 401 }); } });
  await withKeys(s);
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'x' }), (e) => {
    assert.equal(e.status, 502);
    assert.ok(e.message.includes('HTTP 401'));
    assert.ok(!e.message.includes(OKEY) && !e.message.includes('Incorrect API key'));
    return true;
  });
  // 자료 저장 단계의 예기치 않은 오류에 키가 섞여 있어도 지워진다.
  mode = 'ok';
  const storage = Object.assign(createMemoryStorage(), { session: createMemoryStorage() });
  const leaky = createAiClient({
    fetchImpl: async () => json({ data: [{ b64_json: bytesToBase64(PNG) }] }), storage, now: () => new Date('2026-10-18T03:00:00Z'), errorClass: TestApiError,
    assets: { getAssetForAi: async () => null, addAssetFromBytes: async () => { throw new TestApiError(`저장 실패 ${OKEY} / ${GKEY}`, 500, 'X'); } },
  });
  await leaky.aiSaveConfig({ openaiKey: OKEY, geminiKey: GKEY });
  await assert.rejects(() => leaky.aiImage({ projectId: 'p1', prompt: 'x' }), (e) => !e.message.includes(OKEY) && !e.message.includes(GKEY) && e.message.includes('저장 실패'));
  // 잘못된 키 형식 오류도 입력값을 되풀이하지 않는다.
  await assert.rejects(() => s.client.aiSaveConfig({ geminiKey: 'sk-ABCDEFGH12345 with space' }), (e) => !e.message.includes('ABCDEFGH') && e.code === 'AI_VALIDATION');
  const cfg = await s.client.aiConfig();
  assert.equal(JSON.stringify(cfg).includes(OKEY), false);
  assert.equal(JSON.stringify(cfg).includes(GKEY), false);
});

test('네트워크 오류는 자동 재시도 없이 한 번만 호출하고 일반 메시지', async () => {
  const s = setup({ fetchImpl: async () => { throw new TypeError(`fetch failed for key ${OKEY}`); } });
  await withKeys(s);
  await assert.rejects(() => s.client.aiImage({ projectId: 'p1', prompt: 'x' }), (e) => e.code === 'AI_NETWORK' && !e.message.includes(OKEY) && e.message.includes('자동 재시도하지 않았습니다') && !/서버/.test(e.message));
  assert.equal(s.calls.length, 1);
});

test('aiTest: Gemini는 generateContent 모델만, OpenAI는 이미지 모델만, 한도 미사용', async () => {
  const s = setup({ fetchImpl: async (url) => (url.includes('generativelanguage') ? json({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-pro', supportedGenerationMethods: ['generateContent', 'countTokens'] }] }) : json({ data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }, { id: 'chatgpt-image-latest' }, { id: 'whisper-1' }] })) });
  await withKeys(s);
  const g = await s.client.aiTest('gemini');
  assert.deepEqual(g.models, ['gemini-2.5-flash', 'gemini-pro']);
  assert.equal(s.calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
  assert.equal(s.calls[0].init.headers['x-goog-api-key'], GKEY);
  const o = await s.client.aiTest('openai');
  assert.deepEqual(o.models, ['gpt-image-1', 'chatgpt-image-latest']);
  assert.equal(s.calls[1].url, 'https://api.openai.com/v1/models');
  await assert.rejects(() => s.client.aiTest('claude'), (e) => e.code === 'AI_VALIDATION');
  const u = (await s.client.aiConfig()).usage;
  assert.equal(u.images + u.text, 0);
});

test('설정 검증: 모델 이름, 이미지 모델 접두사, 품질, 한도 범위, 알 수 없는 키', async () => {
  const s = setup();
  await assert.rejects(() => s.client.aiSaveConfig({ geminiModel: 'bad model!' }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiSaveConfig({ imageModel: 'dall-e-3' }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiSaveConfig({ quality: 'x' }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiSaveConfig({ dailyImageLimit: 1001 }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiSaveConfig({ dailyTextLimit: 1.5 }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiSaveConfig({ rememberKeys: 'yes' }), (e) => e.code === 'AI_VALIDATION');
  await assert.rejects(() => s.client.aiSaveConfig({ bogus: 1 }), (e) => e.code === 'AI_VALIDATION');
  const ok = await s.client.aiSaveConfig({ geminiModel: 'gemini-2.5-pro', imageModel: 'gpt-image-1.5', quality: 'medium', dailyImageLimit: 3, dailyTextLimit: 0 });
  assert.equal(ok.geminiModel, 'gemini-2.5-pro');
  assert.equal(ok.dailyTextLimit, 0);
  await assert.rejects(() => s.client.aiGemini({ projectId: 'p1', prompt: 'x' }), (e) => e.code === 'AI_NOT_CONFIGURED');
});

test('키 저장 위치: 기억 켜면 설정 DB, 끄면 세션에만, 빈 키 저장은 기존 키 유지, 삭제 플래그, 전체 삭제', async () => {
  const s = setup();
  let cfg = await withKeys(s);
  assert.equal(cfg.geminiSource, 'saved');
  assert.equal(cfg.rememberKeys, true);
  assert.ok((await s.storage.get('keys')).geminiKey);
  cfg = await s.client.aiSaveConfig({ geminiKey: '', openaiKey: '', quality: 'high' });
  assert.equal(cfg.geminiConfigured && cfg.openaiConfigured, true);
  cfg = await s.client.aiSaveConfig({ rememberKeys: false });
  assert.equal(cfg.geminiSource, 'session');
  assert.equal(await s.storage.get('keys'), undefined);
  assert.ok((await s.storage.session.get('personal-studio-session-keys')).openaiKey);
  cfg = await s.client.aiSaveConfig({ rememberKeys: true });
  assert.equal(cfg.geminiSource, 'saved');
  assert.equal(await s.storage.session.get('personal-studio-session-keys'), undefined);
  cfg = await s.client.aiSaveConfig({ removeGemini: true });
  assert.equal(cfg.geminiConfigured, false);
  assert.equal(cfg.openaiConfigured, true);
  await s.client.clearAllAiData();
  cfg = await s.client.aiConfig();
  assert.equal(cfg.openaiConfigured, false);
  assert.equal(cfg.dailyImageLimit, 10);
});
