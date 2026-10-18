// API tests for 나의 창작실 backend. Uses isolated temp data directories only.
// Temp root: STUDIO_TEST_TMP env var if set, otherwise the OS temp dir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createStudioServer, REPO_ROOT } from '../src/server.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(TEST_DIR, '..', 'src', 'server.mjs');
const TMP_BASE = path.resolve(process.env.STUDIO_TEST_TMP || os.tmpdir());

const FORBIDDEN_DATA_DIRS = [path.resolve(REPO_ROOT, '.data'), path.resolve(os.homedir(), '.aside', 'u', '0', 'personal-studio-data')];

const PASSWORD = 'correct-horse-battery-staple-42';
const OWNER = { name: '테스트 소유자', email: 'owner@example.test', password: PASSWORD };
const QUIET = { info() {}, error() {} };

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const JPEG_FAKE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const WEBP_FAKE = (() => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(32, 4);
  b.write('WEBPVP8 ', 8, 'ascii');
  return b;
})();

let tmpRoot;
const servers = [];

function mkTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, prefix));
  for (const bad of FORBIDDEN_DATA_DIRS) assert.notEqual(path.resolve(dir), bad, 'must never use real user data dir');
  return dir;
}

function makePublicDir() {
  const dir = mkTemp('public-');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>나의 창작실</title>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("ok")');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'not allowlisted');
  fs.writeFileSync(path.join(dir, '.hidden.js'), 'secret');
  return dir;
}

async function startServer(opts = {}) {
  const dataDir = opts.dataDir ?? mkTemp('data-');
  const publicDir = opts.publicDir ?? makePublicDir();
  const studio = createStudioServer({ port: 0, logger: QUIET, ...opts, dataDir, publicDir });
  await studio.listen();
  servers.push(studio);
  return { studio, dataDir, publicDir, client: new Client(studio.url) };
}

class Client {
  constructor(base) {
    this.base = base;
    this.origin = base;
    this.cookie = null;
  }
  async req(method, p, { body, json = true, origin = this.origin, cookie = this.cookie, headers = {} } = {}) {
    const h = { ...headers };
    if (origin) h.Origin = origin;
    if (cookie) h.Cookie = cookie;
    let payload;
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (json && !h['Content-Type']) h['Content-Type'] = 'application/json';
    }
    const res = await fetch(this.base + p, { method, headers: h, body: payload });
    const setCookies = res.headers.getSetCookie();
    const ct = res.headers.get('content-type') || '';
    let data;
    if (ct.includes('application/json')) data = await res.json();
    else data = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, data, setCookies };
  }
  get(p, o) {
    return this.req('GET', p, o);
  }
  post(p, body, o = {}) {
    return this.req('POST', p, { ...o, body });
  }
  patch(p, body, o = {}) {
    return this.req('PATCH', p, { ...o, body });
  }
  del(p, o) {
    return this.req('DELETE', p, o);
  }
  async setup(owner = OWNER) {
    const r = await this.post('/api/setup', owner);
    if (r.status === 201) this.cookie = cookiePair(r.setCookies);
    return r;
  }
  async login(email = OWNER.email, password = OWNER.password) {
    const r = await this.post('/api/login', { email, password });
    if (r.status === 200) this.cookie = cookiePair(r.setCookies);
    return r;
  }
}

function cookiePair(setCookies) {
  assert.ok(setCookies.length > 0, 'expected Set-Cookie');
  return setCookies[0].split(';')[0];
}

function rawRequest(port, { method = 'GET', path: p, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function listAssetFiles(dataDir) {
  return fs.readdirSync(path.join(dataDir, 'assets')).sort();
}

before(() => {
  fs.mkdirSync(TMP_BASE, { recursive: true });
  tmpRoot = fs.mkdtempSync(path.join(TMP_BASE, 'personal-studio-test-'));
});

after(async () => {
  for (const s of servers) await s.close().catch(() => {});
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

// ---------------------------------------------------------------------------

test('fresh server: health, status, auth gates, no seeded owner', async () => {
  const { client } = await startServer();
  const health = await client.get('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.data, { ok: true });
  assert.equal(health.headers.get('cache-control'), 'no-store');

  const status = await client.get('/api/status');
  assert.deepEqual(status.data, {
    setupRequired: true,
    authenticated: false,
    user: null,
    ai: { configured: false },
    storage: 'server',
    deployment: 'local',
  });

  for (const p of ['/api/projects', '/api/projects/00000000-0000-4000-8000-000000000000', '/api/assets/00000000-0000-4000-8000-000000000000', '/api/ai/generate']) {
    const r = await client.get(p);
    assert.equal(r.status, 401, p);
    assert.equal(r.data.code, 'UNAUTHORIZED');
    assert.match(r.data.error, /로그인/);
  }
  const login = await client.post('/api/login', { email: OWNER.email, password: PASSWORD });
  assert.equal(login.status, 409);
  assert.equal(login.data.code, 'SETUP_REQUIRED');

  const unknown = await client.get('/api/nope');
  assert.equal(unknown.status, 404);
  assert.equal(typeof unknown.data.error, 'string');
});

test('setup: validation, origin, content-type, cookie flags, single owner', async () => {
  const { client, dataDir } = await startServer();

  let r = await client.post('/api/setup', { ...OWNER, password: 'short' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /12자 이상/);

  r = await client.post('/api/setup', { ...OWNER, email: 'not-an-email' });
  assert.equal(r.status, 400);

  r = await client.post('/api/setup', OWNER, { origin: null });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'FORBIDDEN_ORIGIN');

  r = await client.post('/api/setup', OWNER, { origin: 'http://evil.example' });
  assert.equal(r.status, 403);

  r = await client.post('/api/setup', OWNER, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(r.status, 403);

  r = await client.req('POST', '/api/setup', { body: JSON.stringify(OWNER), json: false, headers: { 'Content-Type': 'text/plain' } });
  assert.equal(r.status, 415);

  r = await client.req('POST', '/api/setup', { body: '{bad json' });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'INVALID_JSON');

  assert.equal((await client.get('/api/status')).data.setupRequired, true, 'failed attempts must not create owner');

  r = await client.setup();
  assert.equal(r.status, 201);
  assert.deepEqual(r.data, { user: { name: OWNER.name, email: OWNER.email } });
  const raw = JSON.stringify(r.data);
  assert.ok(!raw.includes(PASSWORD));
  const setCookie = r.setCookies[0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(setCookie, /Secure/);
  const token = client.cookie.split('=')[1];
  assert.ok(!raw.includes(token), 'token must not be in JSON');

  const status = await client.get('/api/status');
  assert.deepEqual(status.data.user, { name: OWNER.name, email: OWNER.email });
  assert.equal(status.data.authenticated, true);
  assert.equal(status.data.setupRequired, false);

  const second = await new Client(client.base).post('/api/setup', { ...OWNER, email: 'attacker@example.test' });
  assert.equal(second.status, 409);
  assert.equal(second.data.code, 'SETUP_ALREADY_DONE');

  // Password and raw session token are never stored in plain text.
  for (const f of fs.readdirSync(dataDir).filter((n) => n.startsWith('studio.sqlite'))) {
    const bytes = fs.readFileSync(path.join(dataDir, f));
    assert.ok(!bytes.includes(Buffer.from(PASSWORD)), `plain password found in ${f}`);
    assert.ok(!bytes.includes(Buffer.from(token)), `raw session token found in ${f}`);
  }
});

test('setup is atomic under concurrent first-claim requests', async () => {
  const { client } = await startServer();
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => new Client(client.base).post('/api/setup', { ...OWNER, email: `o${i}@example.test` })),
  );
  const codes = results.map((r) => r.status).sort();
  assert.deepEqual(codes, [201, 409, 409, 409, 409]);
});

test('login, logout revocation, generic errors and throttling', async () => {
  const { client } = await startServer({ loginThrottle: { maxAttempts: 3, windowMs: 60_000, lockoutMs: 400 } });
  await client.setup();

  const other = new Client(client.base);
  let r = await other.login(OWNER.email, PASSWORD);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { user: { name: OWNER.name, email: OWNER.email } });

  r = await other.post('/api/logout', {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
  assert.match(r.setCookies[0], /Max-Age=0/);
  // Old cookie is revoked server-side even if replayed.
  r = await other.get('/api/projects');
  assert.equal(r.status, 401);
  assert.equal((await other.get('/api/status')).data.authenticated, false);
  // First session still valid.
  assert.equal((await client.get('/api/projects')).status, 200);

  const attacker = new Client(client.base);
  r = await attacker.post('/api/login', { email: OWNER.email, password: 'wrong-password-123' });
  assert.equal(r.status, 401);
  const wrongPw = r.data.error;
  r = await attacker.post('/api/login', { email: 'nobody@example.test', password: PASSWORD });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, wrongPw, 'error must not reveal which field was wrong');
  r = await attacker.post('/api/login', { email: OWNER.email, password: 'wrong-password-456' });
  assert.equal(r.status, 401);
  // Locked: even the correct password is refused.
  r = await attacker.post('/api/login', { email: OWNER.email, password: PASSWORD });
  assert.equal(r.status, 429);
  assert.equal(r.data.code, 'LOGIN_THROTTLED');
  assert.ok(r.headers.get('retry-after'));
  await new Promise((res) => setTimeout(res, 500));
  r = await attacker.login();
  assert.equal(r.status, 200, 'login works after lockout expires');
});

test('projects: CRUD, validation, version conflict, size limits', async () => {
  const { client, studio } = await startServer();
  await client.setup();

  let r = await client.post('/api/projects', { title: '' });
  assert.equal(r.status, 400);
  r = await client.post('/api/projects', { title: 'x'.repeat(121) });
  assert.equal(r.status, 400);
  r = await client.post('/api/projects', { title: '여행', type: 'business' });
  assert.equal(r.status, 400);
  r = await client.post('/api/projects', { title: '여행', description: 'd'.repeat(2001) });
  assert.equal(r.status, 400);
  r = await client.post('/api/projects', { title: '여행' }, { origin: null });
  assert.equal(r.status, 403);
  r = await client.post('/api/projects', { title: '여행' }, { cookie: null });
  assert.equal(r.status, 401);

  r = await client.post('/api/projects', { title: '제주 여행', description: '가을 기록', type: 'travel' });
  assert.equal(r.status, 201);
  const p = r.data.project;
  assert.equal(p.version, 1);
  assert.equal(p.type, 'travel');
  assert.equal(p.assetCount, 0);
  assert.deepEqual(p.state, {
    story: { script: '', scenes: [] },
    editor: { width: 1280, height: 720, background: '#e8e3d8', baseAssetId: null, fit: 'cover', textLayers: [] },
    notes: '',
  });
  for (const k of ['id', 'title', 'description', 'type', 'version', 'createdAt', 'updatedAt', 'state']) assert.ok(k in p, k);

  r = await client.post('/api/projects', { title: '기본 유형' });
  assert.equal(r.data.project.type, 'other');

  r = await client.get('/api/projects');
  assert.equal(r.status, 200);
  assert.equal(r.data.projects.length, 2);
  assert.ok(r.data.projects.every((x) => !('state' in x)));

  const state = {
    story: {
      script: '첫 장면입니다.\n\n둘째 장면입니다.',
      scenes: [
        { id: 's1', title: '시작', narration: '안녕하세요', prompt: '바다 풍경', duration: 5 },
        { id: 's2', title: '끝', narration: '감사합니다', prompt: '노을', duration: 4.5 },
      ],
    },
    editor: {
      width: 1080,
      height: 1920,
      background: '#112233',
      baseAssetId: null,
      fit: 'contain',
      textLayers: [{ id: 't1', text: '제주', x: 100, y: 200, fontSize: 72, color: '#ffffff', fontFamily: 'Noto Sans KR, sans-serif', align: 'center', shadow: true }],
    },
    notes: '메모',
  };
  r = await client.patch(`/api/projects/${p.id}`, { version: 1, title: '제주 가을 여행', state });
  assert.equal(r.status, 200);
  assert.equal(r.data.project.version, 2);
  assert.equal(r.data.project.title, '제주 가을 여행');
  assert.deepEqual(r.data.project.state, state);

  // Stale version is rejected, nothing overwritten.
  r = await client.patch(`/api/projects/${p.id}`, { version: 1, title: '덮어쓰기 시도' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'VERSION_CONFLICT');
  assert.equal(typeof r.data.error, 'string');
  r = await client.get(`/api/projects/${p.id}`);
  assert.equal(r.data.project.title, '제주 가을 여행');
  assert.equal(r.data.project.version, 2);

  const badStates = [
    { story: { scenes: Array.from({ length: 61 }, (_, i) => ({ id: `s${i}` })) } },
    { story: { script: 'a'.repeat(40001) } },
    { editor: { width: 999, height: 999 } },
    { editor: { textLayers: Array.from({ length: 21 }, (_, i) => ({ id: `t${i}` })) } },
    { editor: { background: 'red;}' } },
    { editor: { fit: 'stretch' } },
    { editor: { baseAssetId: '../../etc/passwd' } },
    { editor: { textLayers: [{ id: 't1', fontFamily: 'x</style><script>' }] } },
    { unknownKey: 1 },
    { story: { scenes: [{ id: 'dup' }, { id: 'dup' }] } },
  ];
  for (const s of badStates) {
    r = await client.patch(`/api/projects/${p.id}`, { version: 2, state: s });
    assert.equal(r.status, 400, JSON.stringify(s).slice(0, 80));
    assert.match(r.data.error, /[가-힣]/, 'Korean error');
  }
  r = await client.patch(`/api/projects/${p.id}`, { version: 2, state: { notes: '가'.repeat(100_000) } });
  assert.equal(r.status, 413);
  assert.equal(r.data.code, 'STATE_TOO_LARGE');
  r = await client.patch(`/api/projects/${p.id}`, { version: 2 });
  assert.equal(r.status, 400);
  r = await client.patch(`/api/projects/${p.id}`, { title: 'no version' });
  assert.equal(r.status, 400);

  // Request body limit is enforced from Content-Length before reading.
  const big = await rawRequest(studio.port, {
    method: 'PATCH',
    path: `/api/projects/${p.id}`,
    headers: {
      Host: `127.0.0.1:${studio.port}`,
      Origin: client.origin,
      Cookie: client.cookie,
      'Content-Type': 'application/json',
      'Content-Length': String(100 * 1024 * 1024),
    },
  });
  assert.equal(big.status, 413);
  assert.equal(JSON.parse(big.body).code, 'PAYLOAD_TOO_LARGE');

  r = await client.get('/api/projects/not-a-uuid');
  assert.equal(r.status, 404);

  r = await client.del(`/api/projects/${p.id}`, { origin: null });
  assert.equal(r.status, 403);
  r = await client.del(`/api/projects/${p.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
  assert.equal((await client.get(`/api/projects/${p.id}`)).status, 404);
});

test('assets: type checks, auth, headers, delete, restart persistence', async () => {
  const first = await startServer();
  const { client, dataDir, publicDir } = first;
  await client.setup();
  const { data } = await client.post('/api/projects', { title: '이미지 작업', type: 'image' });
  const pid = data.project.id;

  let r = await client.post(`/api/projects/${pid}/assets`, { name: '../../evil.png', mime: 'image/png', data: PNG_1X1.toString('base64') });
  assert.equal(r.status, 201);
  const asset = r.data.asset;
  assert.deepEqual(Object.keys(asset).sort(), ['createdAt', 'id', 'mime', 'name', 'projectId', 'size', 'url']);
  assert.equal(asset.url, `/api/assets/${asset.id}`);
  assert.equal(asset.size, PNG_1X1.length);
  assert.equal(asset.projectId, pid);
  assert.ok(!asset.name.includes('/'));

  r = await client.post(`/api/projects/${pid}/assets`, { name: 'a.jpg', mime: 'image/jpeg', data: JPEG_FAKE.toString('base64') });
  assert.equal(r.status, 201);
  r = await client.post(`/api/projects/${pid}/assets`, { name: 'a.webp', mime: 'image/webp', data: `data:image/webp;base64,${WEBP_FAKE.toString('base64')}` });
  assert.equal(r.status, 201);
  const webpId = r.data.asset.id;

  // Rejections
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  r = await client.post(`/api/projects/${pid}/assets`, { name: 'x.svg', mime: 'image/svg+xml', data: svg });
  assert.equal(r.status, 415);
  r = await client.post(`/api/projects/${pid}/assets`, { name: 'x.png', mime: 'image/png', data: Buffer.from('<html><script>alert(1)</script>').toString('base64') });
  assert.equal(r.status, 415);
  r = await client.post(`/api/projects/${pid}/assets`, { name: 'x.png', mime: 'image/png', data: JPEG_FAKE.toString('base64') });
  assert.equal(r.status, 415, 'signature must match declared mime');
  r = await client.post(`/api/projects/${pid}/assets`, { name: 'x.png', mime: 'image/png', data: '***not base64***' });
  assert.equal(r.status, 400);
  const huge = Buffer.concat([PNG_1X1.subarray(0, 8), Buffer.alloc(10 * 1024 * 1024 + 1)]);
  r = await client.post(`/api/projects/${pid}/assets`, { name: 'big.png', mime: 'image/png', data: huge.toString('base64') });
  assert.equal(r.status, 413);
  r = await client.post(`/api/projects/${pid}/assets`, { name: 'a.png', mime: 'image/png', data: PNG_1X1.toString('base64') }, { origin: null });
  assert.equal(r.status, 403);

  r = await client.get(`/api/projects/${pid}/assets`);
  assert.equal(r.data.assets.length, 3);
  assert.equal((await client.get(`/api/projects/${pid}`)).data.project.assetCount, 3);

  // Server UUID file names only, original names never on disk.
  const files = listAssetFiles(dataDir);
  assert.equal(files.length, 3);
  for (const f of files) assert.match(f, /^[0-9a-f-]{36}\.(png|jpg|webp)$/);

  // Binary fetch requires auth and has safe headers.
  r = await client.get(asset.url);
  assert.equal(r.status, 200);
  assert.ok(Buffer.compare(r.data, PNG_1X1) === 0);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  r = await client.get(`${asset.url}?download=1`);
  assert.match(r.headers.get('content-disposition'), /^attachment/);
  r = await client.get(asset.url, { cookie: null });
  assert.equal(r.status, 401);

  r = await client.del(`/api/assets/${webpId}`);
  assert.equal(r.status, 200);
  assert.equal(listAssetFiles(dataDir).length, 2);
  assert.equal((await client.get(`/api/assets/${webpId}`)).status, 404);

  // Save state referencing the asset, then restart on the same data dir.
  r = await client.patch(`/api/projects/${pid}`, { version: 1, state: { editor: { baseAssetId: asset.id } } });
  assert.equal(r.status, 200);
  await first.studio.close();

  const second = await startServer({ dataDir, publicDir });
  second.client.cookie = client.cookie; // session survives restart
  r = await second.client.get(`/api/projects/${pid}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.project.state.editor.baseAssetId, asset.id);
  assert.equal(r.data.project.assetCount, 2);
  r = await second.client.get(asset.url);
  assert.ok(Buffer.compare(r.data, PNG_1X1) === 0);
  assert.equal((await second.client.get('/api/status')).data.setupRequired, false);

  // Deleting the project removes its files.
  r = await second.client.del(`/api/projects/${pid}`);
  assert.equal(r.status, 200);
  assert.equal(listAssetFiles(dataDir).length, 0);
});

test('export/import: self-contained backup, id remap, validation, rollback', async () => {
  const hooks = { fail: false, beforeImportCommit() { if (hooks.fail) throw new Error('injected failure'); } };
  const { client, dataDir } = await startServer({ testHooks: hooks });
  await client.setup();
  const { data } = await client.post('/api/projects', { title: '백업 대상', description: '설명', type: 'story' });
  const pid = data.project.id;
  const up = await client.post(`/api/projects/${pid}/assets`, { name: '표지.png', mime: 'image/png', data: PNG_1X1.toString('base64') });
  const oldAssetId = up.data.asset.id;
  await client.post(`/api/projects/${pid}/assets`, { name: 'b.jpg', mime: 'image/jpeg', data: JPEG_FAKE.toString('base64') });
  const st = { story: { script: '대본', scenes: [{ id: 'a', title: '장면', narration: '', prompt: '', duration: 3 }] }, editor: { baseAssetId: oldAssetId } };
  assert.equal((await client.patch(`/api/projects/${pid}`, { version: 1, state: st })).status, 200);

  let r = await client.get(`/api/projects/${pid}/export`, { cookie: null });
  assert.equal(r.status, 401);
  r = await client.get(`/api/projects/${pid}/export`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment/);
  const backup = r.data;
  assert.deepEqual(Object.keys(backup).sort(), ['assets', 'format', 'project', 'version']);
  assert.equal(backup.format, 'personal-studio-backup');
  assert.equal(backup.version, 1);
  assert.deepEqual(Object.keys(backup.project).sort(), ['description', 'state', 'title', 'type']);
  assert.equal(backup.assets.length, 2);
  for (const a of backup.assets) assert.deepEqual(Object.keys(a).sort(), ['data', 'id', 'mime', 'name']);
  const pngEntry = backup.assets.find((a) => a.id === oldAssetId);
  assert.ok(Buffer.compare(Buffer.from(pngEntry.data, 'base64'), PNG_1X1) === 0);
  const text = JSON.stringify(backup);
  assert.ok(!text.includes(OWNER.email) && !text.includes(PASSWORD) && !text.includes('scrypt'), 'no account data in backup');

  // Valid import -> fresh project with remapped asset ids.
  r = await client.post('/api/import', backup);
  assert.equal(r.status, 201);
  const imported = r.data.project;
  assert.notEqual(imported.id, pid);
  assert.equal(imported.title, '백업 대상');
  assert.equal(imported.assetCount, 2);
  assert.equal(imported.version, 1);
  const newBase = imported.state.editor.baseAssetId;
  assert.ok(newBase && newBase !== oldAssetId, 'baseAssetId remapped');
  const newAssets = (await client.get(`/api/projects/${imported.id}/assets`)).data.assets;
  assert.ok(newAssets.some((a) => a.id === newBase));
  assert.ok(newAssets.every((a) => a.id !== oldAssetId));
  r = await client.get(`/api/assets/${newBase}`);
  assert.ok(Buffer.compare(r.data, PNG_1X1) === 0);
  assert.deepEqual(imported.state.story, st.story);

  const projectCount = async () => (await client.get('/api/projects')).data.projects.length;
  const baselineProjects = await projectCount();
  const baselineFiles = listAssetFiles(dataDir);

  // Invalid inputs: nothing created.
  const invalids = [
    { ...backup, format: 'other' },
    { ...backup, version: 2 },
    { ...backup, assets: [...backup.assets, { id: 'x', name: 'x.png', mime: 'image/png', data: Buffer.from('<html>').toString('base64') }] },
    { ...backup, assets: [backup.assets[0], { ...backup.assets[0] }] },
    { ...backup, project: { ...backup.project, state: { editor: { baseAssetId: 'missing-id' } } } },
    { ...backup, project: { ...backup.project, title: '' } },
    { ...backup, account: { email: 'x' } },
  ];
  for (const bad of invalids) {
    r = await client.post('/api/import', bad);
    assert.ok(r.status === 400 || r.status === 415, `expected rejection, got ${r.status}`);
    assert.match(r.data.error, /[가-힣]/);
  }
  assert.equal(await projectCount(), baselineProjects);
  assert.deepEqual(listAssetFiles(dataDir), baselineFiles);

  // Failure after files were written: DB rolled back and files cleaned up.
  hooks.fail = true;
  r = await client.post('/api/import', backup);
  hooks.fail = false;
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.data).includes('injected'), 'internal error detail not exposed');
  assert.equal(await projectCount(), baselineProjects);
  assert.deepEqual(listAssetFiles(dataDir), baselineFiles);

  r = await client.post('/api/import', backup, { origin: 'http://evil.example' });
  assert.equal(r.status, 403);
  r = await client.post('/api/import', backup, { cookie: null });
  assert.equal(r.status, 401);
});

test('AI routes are explicit 501 not-configured behind auth and origin checks', async () => {
  const { client } = await startServer();
  await client.setup();
  let r = await client.post('/api/ai/generate-image', { prompt: 'x' }, { origin: null });
  assert.equal(r.status, 403);
  r = await client.post('/api/ai/generate-image', { prompt: 'x' }, { cookie: null });
  assert.equal(r.status, 401);
  r = await client.post('/api/ai/generate-image', { prompt: 'x' });
  assert.equal(r.status, 501);
  assert.deepEqual(r.data, { error: 'AI 제공자가 연결되지 않았습니다. 유료 호출은 실행하지 않았습니다.', code: 'AI_NOT_CONFIGURED' });
  r = await client.get('/api/ai/models');
  assert.equal(r.status, 501);
});

test('static: allowlist only, traversal blocked, security headers, host check', async () => {
  const { client, studio, dataDir } = await startServer();
  let r = await client.get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  r = await client.get('/app.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);

  const blocked = [
    '/notes.md',
    '/.hidden.js',
    '/../src/server.mjs',
    '/..%2fsrc%2fserver.mjs',
    '/%2e%2e/%2e%2e/.planning/PROJECT.md',
    '/.planning/PROJECT.md',
    '/.data/studio.sqlite',
    '/src/server.mjs',
    '/package.json',
    '/..\\src\\server.mjs',
    '/app.js%00.png',
    `/${path.basename(dataDir)}/studio.sqlite`,
  ];
  for (const p of blocked) {
    const res = await rawRequest(studio.port, { path: p, headers: { Host: `127.0.0.1:${studio.port}` } });
    assert.ok(res.status === 404 || res.status === 400, `${p} -> ${res.status}`);
    assert.ok(!res.body.includes('createStudioServer') && !res.body.includes('SQLite'), p);
  }
  r = await client.post('/index.html', {});
  assert.equal(r.status, 405);

  // DNS-rebinding style Host headers are refused.
  const evil = await rawRequest(studio.port, { path: '/api/status', headers: { Host: `evil.example:${studio.port}` } });
  assert.equal(evil.status, 421);
  const localhostOk = await rawRequest(studio.port, { path: '/api/health', headers: { Host: `localhost:${studio.port}` } });
  assert.equal(localhostOk.status, 200);
});

test('config guards: default static root, overlapping dirs, remote bind refusal, secure cookies', async () => {
  const dataDir = mkTemp('data-');
  const defaults = createStudioServer({ dataDir, port: 0, logger: QUIET });
  servers.push(defaults);
  assert.equal(path.resolve(defaults.config.publicDir), fs.existsSync(path.join(REPO_ROOT, 'public')) ? fs.realpathSync(path.join(REPO_ROOT, 'public')) : path.join(REPO_ROOT, 'public'));
  await defaults.close();

  const pub = makePublicDir();
  assert.throws(() => createStudioServer({ dataDir: path.join(pub, 'data'), publicDir: pub, logger: QUIET }), /겹칠 수 없습니다/);

  const remote = createStudioServer({ dataDir: mkTemp('data-'), publicDir: makePublicDir(), host: '0.0.0.0', port: 0, logger: QUIET });
  servers.push(remote);
  await assert.rejects(remote.listen(), /STUDIO_ALLOW_REMOTE/);
  await remote.close();
  const remote2 = createStudioServer({ dataDir: mkTemp('data-'), publicDir: makePublicDir(), host: '0.0.0.0', port: 0, allowRemote: true, logger: QUIET });
  servers.push(remote2);
  await assert.rejects(remote2.listen(), /소유자 계정이 아직 없습니다/);
  await remote2.close();

  const { client } = await startServer({ secureCookies: true });
  const r = await client.setup();
  assert.equal(r.status, 201);
  assert.match(r.setCookies[0], /^__Host-studio_session=/);
  assert.match(r.setCookies[0], /; Secure/);
});

test('direct run: node src/server.mjs logs only the local URL and serves', async () => {
  const dataDir = mkTemp('data-');
  const publicDir = makePublicDir();
  const env = { ...process.env, DATA_DIR: dataDir, PUBLIC_DIR: publicDir, PORT: '0', HOST: '127.0.0.1' };
  delete env.STUDIO_ALLOW_REMOTE;
  delete env.STUDIO_PUBLIC_ORIGIN;
  const child = spawn(process.execPath, [SERVER_ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start: ${stdout}`)), 15_000);
      child.stdout.on('data', (c) => {
        stdout += c.toString('utf8');
        const m = /http:\/\/127\.0\.0\.1:\d+/.exec(stdout);
        if (m) {
          clearTimeout(timer);
          resolve(m[0]);
        }
      });
      child.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
    });
    const res = await fetch(`${url}/api/health`);
    assert.deepEqual(await res.json(), { ok: true });
    const status = await (await fetch(`${url}/api/status`)).json();
    assert.equal(status.setupRequired, true, 'no owner is seeded on startup');
    assert.deepEqual(stdout.trim().split(/\r?\n/), [`나의 창작실 로컬 서버: ${url}`]);
    assert.ok(fs.existsSync(path.join(dataDir, 'studio.sqlite')), 'uses configured DATA_DIR');
  } finally {
    child.kill();
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
  }
});
