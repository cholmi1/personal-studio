// 브라우저에서 실제 IndexedDB 로 local-db.js / api.js 를 검수한다.
// 실행: 저장소 루트를 정적 서버로 열고 /tests/storage-harness.html 을 연다. (public 폴더에는 두지 않는다)
import { studioApi, assetUrl, ApiError } from '../public/api.js';
import * as db from '../public/local-db.js';

const results = [];
const messages = [];
const log = document.getElementById('log');
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); log.append(`PASS ${name}\n`); }
  catch (e) { results.push({ name, ok: false, error: String(e && e.stack || e) }); log.append(`FAIL ${name}\n   ${e && e.message}\n`); }
}
const assert = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const eq = (a, b, m = '') => assert(JSON.stringify(a) === JSON.stringify(b), `${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
async function rejects(fn, { status, code, label = '' } = {}) {
  try { await fn(); } catch (e) {
    assert(e instanceof ApiError, `${label} ApiError expected, got ${e && e.name}: ${e && e.message}`);
    messages.push(e.message);
    if (status !== undefined) assert(e.status === status, `${label} status ${e.status} != ${status} (${e.message})`);
    if (code !== undefined) assert(e.code === code, `${label} code ${e.code} != ${code} (${e.message})`);
    return e;
  }
  throw new Error(`${label} should have rejected`);
}
const b64 = (bytes) => db.bytesToBase64(bytes);
const PNG1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
async function canvasBytes(type, color) {
  const c = document.createElement('canvas'); c.width = 24; c.height = 16;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 24, 16);
  const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
  return blob && blob.type === type ? new Uint8Array(await blob.arrayBuffer()) : null;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

await db.resetDatabaseForTests();
let P; // 주 작업
let png, jpeg, webp;

await t('status: 로컬 사용자·저장소 표기', async () => {
  const s = await studioApi.status();
  eq([s.setupRequired, s.authenticated, s.storage, s.deployment, s.user.name], [false, true, 'browser', 'static', '나']);
  assert(typeof s.ai.configured === 'boolean');
  eq(await studioApi.login('a', 'b'), { user: { name: '나', email: '' } });
  eq(await studioApi.logout(), { ok: true });
});

await t('createProject: 기본 상태·검증 오류', async () => {
  P = (await studioApi.createProject({ title: '  첫 작업 ', description: '설명', type: 'image' })).project;
  eq([P.title, P.version, P.type, P.assetCount], ['첫 작업', 1, 'image', 0]);
  assert(/^[0-9a-f-]{36}$/.test(P.id), 'uuid');
  eq(Object.keys(P.state), ['story', 'editor', 'promptLab', 'detailPage', 'featureStudio', 'notes']);
  await rejects(() => studioApi.createProject({ title: '   ' }), { status: 400, label: 'empty title' });
  await rejects(() => studioApi.createProject({ title: 'x', type: 'weird' }), { status: 400, label: 'bad type' });
  await rejects(() => studioApi.createProject({ title: 'x', extra: 1 }), { status: 400, label: 'unknown key' });
  const d = (await studioApi.createProject({ title: '기본' })).project;
  eq(d.type, 'other');
  await studioApi.deleteProject(d.id);
});

await t('getProject/listProjects: 목록·404', async () => {
  const g = (await studioApi.getProject(P.id)).project;
  eq(g.id, P.id);
  const l = (await studioApi.listProjects()).projects;
  assert(l.length === 1 && !('state' in l[0]), 'list has no state');
  await rejects(() => studioApi.getProject('00000000-0000-4000-8000-000000000000'), { status: 404, code: 'NOT_FOUND', label: 'missing' });
});

await t('patchProject: 저장·버전 증가·검증', async () => {
  const st = JSON.parse(JSON.stringify(P.state));
  st.notes = '메모 저장'; st.story.script = '가나다';
  const r = (await studioApi.patchProject(P.id, { version: 1, title: '바뀐 제목', state: st })).project;
  eq([r.version, r.title, r.state.notes], [2, '바뀐 제목', '메모 저장']);
  P = r;
  const reread = (await studioApi.getProject(P.id)).project;
  eq([reread.version, reread.state.story.script], [2, '가나다']);
  await rejects(() => studioApi.patchProject(P.id, { version: 2, state: { bogus: 1 } }), { status: 400, label: 'unknown state key' });
  await rejects(() => studioApi.patchProject(P.id, { version: 2 }), { status: 400, label: 'no change' });
  await rejects(() => studioApi.patchProject(P.id, { version: 2, title: '' }), { status: 400, label: 'empty title' });
  await rejects(() => studioApi.patchProject(P.id, { version: 2, state: { notes: 'ㅁ'.repeat(100000) } }), { status: 413, label: 'state too large' });
  await rejects(() => studioApi.patchProject(P.id, { version: 2, state: { featureStudio: { a: 'x'.repeat(110 * 1024) } } }), { status: 413, label: 'feature too large' });
  eq((await studioApi.getProject(P.id)).project.version, 2, 'failed patches do not bump version');
});

await t('버전 충돌: 오래된 버전은 VERSION_CONFLICT 409, 내용 보존', async () => {
  const e = await rejects(() => studioApi.patchProject(P.id, { version: 1, title: '덮어쓰기' }), { status: 409, code: 'VERSION_CONFLICT', label: 'stale' });
  assert(!e.message.includes('서버'));
  eq((await studioApi.getProject(P.id)).project.title, '바뀐 제목');
});

await t('동시 저장 두 건 중 정확히 한 건만 성공', async () => {
  const cur = (await studioApi.getProject(P.id)).project;
  const out = await Promise.allSettled([
    studioApi.patchProject(cur.id, { version: cur.version, title: '탭A' }),
    studioApi.patchProject(cur.id, { version: cur.version, title: '탭B' }),
  ]);
  eq(out.filter((o) => o.status === 'fulfilled').length, 1, 'one winner');
  const lost = out.find((o) => o.status === 'rejected');
  eq(lost.reason.code, 'VERSION_CONFLICT');
  P = (await studioApi.getProject(P.id)).project;
  eq(P.version, cur.version + 1);
});

await t('uploadAsset: png/jpeg/webp·URL·목록', async () => {
  png = await canvasBytes('image/png', '#f00'); jpeg = await canvasBytes('image/jpeg', '#0f0'); webp = await canvasBytes('image/webp', '#00f');
  assert(png && jpeg, 'canvas encoders');
  const a = (await studioApi.uploadAsset(P.id, '빨강.png', 'image/png', b64(png))).asset;
  eq([a.name, a.mime, a.size, a.projectId], ['빨강.png', 'image/png', png.length, P.id]);
  assert(a.url.startsWith('blob:') && assetUrl(a) === a.url, 'sync assetUrl');
  assert((await (await fetch(a.url)).blob()).size === png.length, 'blob url serves bytes');
  await studioApi.uploadAsset(P.id, '초록.jpg', 'image/jpeg', b64(jpeg));
  if (webp) await studioApi.uploadAsset(P.id, '파랑.webp', 'image/webp', b64(webp));
  const list = (await studioApi.listAssets(P.id)).assets;
  eq(list.map((x) => x.name).slice(0, 2), ['빨강.png', '초록.jpg'], 'upload order');
  for (const x of list) eq(Object.keys(x).sort(), ['createdAt', 'id', 'mime', 'name', 'projectId', 'size', 'url']);
  eq((await studioApi.listProjects()).projects[0].assetCount, list.length);
});

await t('uploadAsset: 형식·크기·내용 검증', async () => {
  await rejects(() => studioApi.uploadAsset(P.id, 'x.gif', 'image/gif', b64(PNG1)), { status: 415, label: 'gif mime' });
  await rejects(() => studioApi.uploadAsset(P.id, 'x.jpg', 'image/jpeg', b64(png)), { status: 415, code: 'INVALID_IMAGE', label: 'mime mismatch' });
  await rejects(() => studioApi.uploadAsset(P.id, 'x.png', 'image/png', b64(new TextEncoder().encode('not an image at all'))), { status: 415, label: 'not image' });
  await rejects(() => studioApi.uploadAsset(P.id, 'x.png', 'image/png', '###'), { status: 400, label: 'bad base64' });
  const big = new Uint8Array(10 * 1024 * 1024 + 1); big.set(PNG1.subarray(0, 8));
  await rejects(() => studioApi.uploadAsset(P.id, 'big.png', 'image/png', b64(big)), { status: 413, label: '10MB' });
  await rejects(() => studioApi.uploadAsset('00000000-0000-4000-8000-000000000000', 'x.png', 'image/png', b64(PNG1)), { status: 404, label: 'no project' });
  const n = (await studioApi.uploadAsset(P.id, '../../etc/pass\u0000wd.png', 'image/png', b64(PNG1))).asset;
  assert(!/[\\/\u0000]/.test(n.name), 'name sanitized: ' + n.name);
  await studioApi.deleteAsset(n.id);
});

await t('getAssetForAi / addAssetFromBytes: 바이트 왕복', async () => {
  const list = (await studioApi.listAssets(P.id)).assets;
  const got = await db.getAssetForAi(list[0].id);
  eq([got.id, got.projectId, got.mime, got.name], [list[0].id, P.id, 'image/png', '빨강.png']);
  assert(got.bytes instanceof Uint8Array && same(got.bytes, png), 'bytes equal');
  assert((await db.getAssetForAi('nope')) === null, 'missing -> null');
  const added = await db.addAssetFromBytes(P.id, 'AI 생성 이미지.png', 'image/png', PNG1);
  eq([added.name, added.size, added.projectId], ['AI 생성 이미지.png', PNG1.length, P.id]);
  assert(added.url.startsWith('blob:') && assetUrl(added) === added.url);
  assert(same((await db.getAssetForAi(added.id)).bytes, PNG1));
  await rejects(() => db.addAssetFromBytes(P.id, 'x.png', 'image/png', new Uint8Array([1, 2, 3])), { status: 415, label: 'bad bytes' });
  await studioApi.deleteAsset(added.id);
});

await t('이미지 200개 제한 (ASSET_LIMIT 409)', async () => {
  const cur = (await studioApi.listAssets(P.id)).assets.length;
  for (let i = cur; i < 200; i++) await db.addAssetFromBytes(P.id, `t${i}.png`, 'image/png', PNG1);
  eq((await studioApi.listAssets(P.id)).assets.length, 200);
  const e = await rejects(() => db.addAssetFromBytes(P.id, 'over.png', 'image/png', PNG1), { status: 409, code: 'ASSET_LIMIT', label: '201st' });
  eq((await studioApi.listAssets(P.id)).assets.length, 200, 'no partial write');
  // 정리: 앞의 3개를 남기고 나머지 삭제
  const all = (await studioApi.listAssets(P.id)).assets;
  for (const a of all.slice(3)) await studioApi.deleteAsset(a.id);
  assert(e.message.includes('200'));
});

let backupText;
await t('exportProject: Response·서버판과 같은 형식', async () => {
  const keep = (await studioApi.listAssets(P.id)).assets;
  const st = JSON.parse(JSON.stringify((await studioApi.getProject(P.id)).project.state));
  st.editor.baseAssetId = keep[0].id;
  st.editor.imageLayers = [{ id: 'l1', assetId: keep[1].id, x: 1, y: 2, w: 30, h: 30, opacity: 1 }, { id: 'l2', assetId: 'ghost-id', x: 0, y: 0, w: 9, h: 9, opacity: 1 }];
  st.story.characters = [{ id: 'c1', name: '지수', look: '단발', assetId: keep[0].id }];
  st.story.scenes = [{ id: 's1', title: '장면', narration: '', prompt: '', duration: 3, imagePrompt: '', assetId: keep[1].id, characterIds: ['c1'] }];
  st.detailPage.productAssetIds = [keep[0].id, keep[1].id];
  st.detailPage.modelAssetId = keep[2] ? keep[2].id : null;
  st.detailPage.plan = { productName: 'p', summary: 's', palette: ['#fff'], sections: [{ id: 'd1', type: 'hero', assetId: keep[0].id, layers: [] }] };
  st.featureStudio = { activeTool: 'compose', canvas: { inputAssetId: keep[0].id, resultAssetId: keep[1].id, refIds: [keep[0].id, keep[1].id, 'ghost-id'] },
    compose: { mode: 'multi', regions: [{ id: 'r1', x: 5, y: 5, w: 30, h: 30, assetId: keep[1].id, prompt: '' }] }, signature: { prompt: '숲' } };
  const cur = (await studioApi.getProject(P.id)).project;
  P = (await studioApi.patchProject(P.id, { version: cur.version, state: st })).project;
  const res = await studioApi.exportProject(P.id);
  assert(res instanceof Response && res.ok, 'Response');
  const blob = await res.blob();
  backupText = await blob.text();
  const j = JSON.parse(backupText);
  eq(Object.keys(j), ['format', 'version', 'project', 'assets']);
  eq([j.format, j.version], ['personal-studio-backup', 1]);
  eq(Object.keys(j.project), ['title', 'description', 'type', 'state']);
  eq(j.assets.length, keep.length);
  eq(Object.keys(j.assets[0]), ['id', 'name', 'mime', 'data']);
  assert(same(Uint8Array.from(atob(j.assets[0].data), (c) => c.charCodeAt(0)), png), 'asset bytes preserved');
  assert(!backupText.includes('"blob"') && !backupText.includes('blob:'), 'no blob refs');
});

await t('importBackup: 새 작업·id 재매핑·왕복', async () => {
  const before = (await studioApi.listProjects()).projects.length;
  const r = (await studioApi.importBackup(backupText)).project;
  assert(r.id !== P.id && r.version === 1, 'new project');
  eq((await studioApi.listProjects()).projects.length, before + 1);
  const oldAssets = (await studioApi.listAssets(P.id)).assets;
  const newAssets = (await studioApi.listAssets(r.id)).assets;
  eq(newAssets.length, oldAssets.length);
  const oldIds = new Set(oldAssets.map((a) => a.id)); const newIds = new Set(newAssets.map((a) => a.id));
  assert(![...newIds].some((id) => oldIds.has(id)), 'all ids are new');
  eq(newAssets.map((a) => a.name), oldAssets.map((a) => a.name), 'order+names');
  const s = r.state;
  const in_ = (id) => newIds.has(id);
  assert(in_(s.editor.baseAssetId), 'base');
  eq(s.editor.imageLayers.length, 1, 'ghost layer dropped'); assert(in_(s.editor.imageLayers[0].assetId));
  assert(in_(s.story.characters[0].assetId) && in_(s.story.scenes[0].assetId), 'story');
  assert(s.detailPage.productAssetIds.length === 2 && s.detailPage.productAssetIds.every(in_), 'product ids');
  if (s.detailPage.modelAssetId) assert(in_(s.detailPage.modelAssetId));
  assert(in_(s.detailPage.plan.sections[0].assetId), 'plan section');
  const f = s.featureStudio;
  assert(in_(f.canvas.inputAssetId) && in_(f.canvas.resultAssetId), 'feature scalar refs');
  eq(f.canvas.refIds.length, 2, 'ghost ref dropped'); assert(f.canvas.refIds.every(in_));
  assert(in_(f.compose.regions[0].assetId), 'region'); eq(f.activeTool, 'compose'); eq(f.signature.prompt, '숲');
  eq(r.title, P.title);
  const bytes = await db.getAssetForAi(newAssets[0].id);
  assert(same(bytes.bytes, png), 'imported bytes equal');
  await studioApi.deleteProject(r.id);
});

await t('importBackup: 서버판 백업(비-UUID id·부분 상태) 가져오기', async () => {
  const serverStyle = JSON.stringify({
    format: 'personal-studio-backup', version: 1,
    project: { title: '서버판 백업', description: '', type: 'travel', state: { editor: { width: 1280, height: 720, background: '#e8e3d8', baseAssetId: 'old-base', fit: 'cover', textLayers: [], imageLayers: [{ id: 'x', assetId: 'old-base', x: 0, y: 0, w: 10, h: 10, opacity: 1 }] }, notes: '메모' } },
    assets: [{ id: 'old-base', name: 'one.png', mime: 'image/png', data: b64(PNG1) }],
  });
  const r = (await studioApi.importBackup(serverStyle)).project;
  const a = (await studioApi.listAssets(r.id)).assets;
  eq(a.length, 1);
  eq([r.type, r.state.notes, r.state.editor.baseAssetId], ['travel', '메모', a[0].id]);
  eq(r.state.editor.imageLayers[0].assetId, a[0].id);
  assert(Array.isArray(r.state.story.scenes) && r.state.detailPage.settings.template === 'basic' && r.state.promptLab.ratio === '16:9', 'defaults filled');
  await studioApi.deleteProject(r.id);
});

await t('importBackup: 잘못된 백업은 거부하고 아무것도 남기지 않음', async () => {
  const count = async () => (await studioApi.listProjects()).projects.length;
  const base = await count();
  const ok = { format: 'personal-studio-backup', version: 1, project: { title: 'T', state: {} }, assets: [] };
  await rejects(() => studioApi.importBackup('not json'), { status: 400, label: 'not json' });
  await rejects(() => studioApi.importBackup(JSON.stringify({ ...ok, format: 'other' })), { status: 400, label: 'format' });
  await rejects(() => studioApi.importBackup(JSON.stringify({ ...ok, version: 2 })), { status: 400, label: 'version' });
  await rejects(() => studioApi.importBackup(JSON.stringify({ ...ok, project: { title: '', state: {} } })), { status: 400, label: 'title' });
  await rejects(() => studioApi.importBackup(JSON.stringify({ ...ok, project: { title: 'T', state: { evil: 1 } } })), { status: 400, label: 'state key' });
  const a = { id: 'a', name: 'a.png', mime: 'image/png', data: b64(PNG1) };
  await rejects(() => studioApi.importBackup(JSON.stringify({ ...ok, assets: [a, a] })), { status: 400, label: 'dup id' });
  await rejects(() => studioApi.importBackup(JSON.stringify({ ...ok, assets: [{ ...a, mime: 'image/jpeg' }] })), { status: 415, label: 'mismatch' });
  await rejects(() => studioApi.importBackup(JSON.stringify({ ...ok, assets: [{ ...a, data: '@@@' }] })), { status: 400, label: 'b64' });
  await rejects(() => studioApi.importBackup(JSON.stringify({ ...ok, assets: [{ ...a, extra: 1 }] })), { status: 400, label: 'asset key' });
  eq(await count(), base, 'no partial projects');
});

await t('deleteAsset: 삭제·URL 해제·404', async () => {
  const [first] = (await studioApi.listAssets(P.id)).assets;
  const url = first.url;
  eq(await studioApi.deleteAsset(first.id), { ok: true });
  assert(assetUrl(first) !== url && assetUrl(first).startsWith('data:'), 'url revoked');
  await rejects(() => studioApi.deleteAsset(first.id), { status: 404, label: 'again' });
  assert((await db.getAssetForAi(first.id)) === null);
});

await t('deleteProject: 이미지까지 삭제', async () => {
  const assets = (await studioApi.listAssets(P.id)).assets;
  assert(assets.length > 0);
  eq(await studioApi.deleteProject(P.id), { ok: true });
  await rejects(() => studioApi.getProject(P.id), { status: 404, label: 'project gone' });
  await rejects(() => studioApi.listAssets(P.id), { status: 404, label: 'assets gone' });
  for (const a of assets) { assert((await db.getAssetForAi(a.id)) === null, 'asset row removed'); assert(assetUrl(a).startsWith('data:'), 'url revoked'); }
  eq((await studioApi.listProjects()).projects.length, 0);
});

await t('AI 위임: ai-client.js 없을 때 안전한 오류, 저장소 정보', async () => {
  // 잘못된 제공자 이름만 보내므로 어떤 경우에도 외부 요청이 나가지 않는다.
  let err = null;
  try { await studioApi.aiTest('invalid-provider'); } catch (x) { err = x; }
  assert(err instanceof Error, 'invalid provider must fail safely');
  if (err instanceof ApiError) messages.push(err.message);
  const info = await db.getStorageInfo();
  assert('persisted' in info && 'usage' in info && 'quota' in info);
  log.append(`storage info: ${JSON.stringify(info)}\n`);
});

await t('저장 공간 부족 오류는 백업 안내 한국어 메시지', async () => {
  const q = db.mapStorageError(new DOMException('full', 'QuotaExceededError'));
  assert(q instanceof ApiError && q.code === 'STORAGE_QUOTA' && q.message.includes('백업') && q.message.includes('공간'));
  messages.push(q.message);
});

await t('모든 오류 메시지에 "서버"가 없음', async () => {
  const bad = messages.filter((m) => m.includes('서버'));
  assert(bad.length === 0, `server mentioned: ${bad.join(' | ')}`);
  assert(messages.length > 20, `only ${messages.length} messages collected`);
});

const pass = results.filter((r) => r.ok).length;
const failCount = results.length - pass;
window.__results = { pass, fail: failCount, total: results.length, failures: results.filter((r) => !r.ok) };
document.getElementById('summary').textContent = `통과 ${pass} / 실패 ${failCount} / 전체 ${results.length}`;
document.getElementById('summary').className = failCount ? 'no' : 'ok';
document.title = failCount ? 'FAIL' : 'PASS';
