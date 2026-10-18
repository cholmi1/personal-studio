// 나의 창작실 local server: Node built-in HTTP + node:sqlite + crypto, zero dependencies.
import http from 'node:http';
import fs, { promises as fsp, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { openDatabase, transaction } from './db.mjs';
import { hashPassword, verifyPassword, dummyHash, newSessionToken, hashToken, LoginThrottle } from './auth.mjs';
import {
  HttpError,
  KiB,
  MiB,
  sendJson,
  sendError,
  readJson,
  parseCookies,
  serializeCookie,
  API_SECURITY_HEADERS,
} from './http-utils.mjs';
import {
  LIMITS,
  IMAGE_MIMES,
  defaultState,
  isUuid,
  validateSetup,
  validateLogin,
  validateTitle,
  validateDescription,
  validateType,
  validateVersion,
  validateState,
  validateImagePayload,
  validateBackup,
} from './validation.mjs';
import { resolveStatic, serveStaticFile, isInside, PAGE_SECURITY_HEADERS } from './static.mjs';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SRC_DIR, '..');
export const DEFAULT_PORT = 4318;
export const DEFAULT_HOST = '127.0.0.1';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;
const MAX_PROJECTS = 1000;

const BODY_LIMITS = {
  small: 16 * KiB,
  project: 64 * KiB,
  patch: 512 * KiB,
  asset: 15 * MiB,
  import: LIMITS.importRequestMax,
};

const AI_NOT_CONFIGURED = {
  error: 'AI 제공자가 연결되지 않았습니다. 유료 호출은 실행하지 않았습니다.',
  code: 'AI_NOT_CONFIGURED',
};

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ASSET_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export function isLoopbackHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

function isLoopbackAddress(addr) {
  if (!addr) return false;
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return a === '::1' || /^127(?:\.\d{1,3}){3}$/.test(a);
}

function hostnameOf(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader || hostHeader.length > 255) return null;
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end < 0) return null;
    return h.slice(0, end + 1);
  }
  const idx = h.lastIndexOf(':');
  return idx >= 0 ? h.slice(0, idx) : h;
}

function parsePort(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`포트 번호가 올바르지 않습니다: ${value}`);
  return n;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Create (but do not start) the studio server.
 * @param {object} options
 * @param {string} [options.dataDir]      SQLite + asset storage directory (default <repo>/.data)
 * @param {string} [options.publicDir]    static root (default <repo>/public)
 * @param {string} [options.host]         bind host (default 127.0.0.1)
 * @param {number} [options.port]         port (default 4318, 0 = ephemeral)
 * @param {string} [options.publicOrigin] exact expected Origin (e.g. https://studio.example) for proxied HTTPS
 * @param {string[]} [options.allowedHosts] extra Host header names allowed besides loopback names
 * @param {boolean} [options.secureCookies] force Secure cookies (default: true when publicOrigin is https)
 * @param {boolean} [options.allowRemote] allow binding a non-loopback host (requires existing owner)
 * @param {object} [options.loginThrottle] {maxAttempts, windowMs, lockoutMs, globalMaxAttempts}
 * @param {number} [options.sessionTtlMs]
 * @param {object} [options.logger]       {info, error}; defaults to console
 * @param {object} [options.testHooks]    test-only hooks, e.g. {beforeImportCommit(){throw ...}}
 */
export function createStudioServer(options = {}) {
  const logger = options.logger ?? console;
  const dataDir = path.resolve(REPO_ROOT, options.dataDir ?? '.data');
  const publicDirRaw = path.resolve(REPO_ROOT, options.publicDir ?? 'public');
  const host = options.host || DEFAULT_HOST;
  const port = parsePort(options.port, DEFAULT_PORT);
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : null;
  const secureCookies = options.secureCookies ?? (publicOrigin ? publicOrigin.startsWith('https:') : false);
  const allowRemote = options.allowRemote === true;
  const sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;
  const cookieName = secureCookies ? '__Host-studio_session' : 'studio_session';
  // Test-only failure injection (e.g. to verify import rollback). Never set in production.
  const testHooks = options.testHooks ?? null;

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dataReal = fs.realpathSync(dataDir);
  const publicDir = fs.existsSync(publicDirRaw) ? fs.realpathSync(publicDirRaw) : publicDirRaw;
  if (isInside(publicDir, dataReal) || isInside(dataReal, publicDir)) {
    throw new Error('데이터 폴더(DATA_DIR)와 공개 정적 폴더(public)는 서로 겹칠 수 없습니다.');
  }
  const assetsDir = path.join(dataReal, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
  // Remove leftovers from interrupted writes (only our own temp files).
  for (const name of fs.readdirSync(assetsDir)) {
    if (name.startsWith('.tmp-')) {
      try {
        fs.unlinkSync(path.join(assetsDir, name));
      } catch {
        /* ignore */
      }
    }
  }

  const db = openDatabase(path.join(dataReal, 'studio.sqlite'));
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());

  const allowedHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
  for (const h of options.allowedHosts ?? []) if (h) allowedHostnames.add(String(h).trim().toLowerCase());
  if (publicOrigin) allowedHostnames.add(new URL(publicOrigin).hostname.toLowerCase());
  if (!isLoopbackHost(host) && host !== '0.0.0.0' && host !== '::') allowedHostnames.add(host.toLowerCase());

  const throttle = new LoginThrottle(options.loginThrottle);

  // ---------- prepared statements ----------
  const q = {
    ownerCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
    owner: db.prepare('SELECT id, name, email, password_hash FROM users WHERE id = 1'),
    insertOwner: db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (1, ?, ?, ?, ?)'),
    sessionUser: db.prepare(
      'SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    ),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    trimSessions: db.prepare(
      'DELETE FROM sessions WHERE token_hash NOT IN (SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT ?)',
    ),
    listProjects: db.prepare(
      `SELECT p.id, p.title, p.description, p.type, p.version, p.created_at, p.updated_at,
              (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count
         FROM projects p ORDER BY p.updated_at DESC, p.created_at DESC`,
    ),
    getProject: db.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count
         FROM projects p WHERE p.id = ?`,
    ),
    projectCount: db.prepare('SELECT COUNT(*) AS n FROM projects'),
    projectVersion: db.prepare('SELECT version FROM projects WHERE id = ?'),
    insertProject: db.prepare(
      'INSERT INTO projects (id, title, description, type, version, state, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    ),
    updateProject: db.prepare(
      'UPDATE projects SET title = ?, description = ?, type = ?, state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
    ),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
    listAssets: db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at ASC, rowid ASC'),
    assetCount: db.prepare('SELECT COUNT(*) AS n FROM assets WHERE project_id = ?'),
    getAsset: db.prepare('SELECT * FROM assets WHERE id = ?'),
    insertAsset: db.prepare(
      'INSERT INTO assets (id, project_id, name, mime, size, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    deleteAsset: db.prepare('DELETE FROM assets WHERE id = ?'),
  };

  // ---------- helpers ----------
  const hasOwner = () => q.ownerCount.get().n > 0;

  function publicUser(row) {
    return { name: row.name, email: row.email };
  }

  function getSessionUser(req) {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    return q.sessionUser.get(hashToken(token), Date.now()) ?? null;
  }

  function requireUser(req) {
    const user = getSessionUser(req);
    if (!user) throw new HttpError(401, '로그인이 필요합니다.', 'UNAUTHORIZED');
    return user;
  }

  function createSessionCookie(userId) {
    const token = newSessionToken();
    const now = Date.now();
    q.deleteExpiredSessions.run(now);
    q.insertSession.run(hashToken(token), userId, now, now + sessionTtlMs);
    q.trimSessions.run(MAX_SESSIONS);
    return serializeCookie(cookieName, token, { maxAge: Math.floor(sessionTtlMs / 1000), secure: secureCookies });
  }

  function clearCookie() {
    return serializeCookie(cookieName, '', { maxAge: 0, secure: secureCookies });
  }

  function checkOrigin(req) {
    const origin = req.headers.origin;
    const expected = publicOrigin ?? `${req.socket.encrypted ? 'https' : 'http'}://${String(req.headers.host).toLowerCase()}`;
    if (typeof origin !== 'string' || origin.toLowerCase() !== expected) {
      throw new HttpError(403, '허용되지 않은 요청 출처입니다. 같은 주소의 화면에서만 변경할 수 있습니다.', 'FORBIDDEN_ORIGIN');
    }
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') {
      throw new HttpError(403, '허용되지 않은 요청 출처입니다. 같은 주소의 화면에서만 변경할 수 있습니다.', 'FORBIDDEN_ORIGIN');
    }
  }

  function projectJson(row, includeState) {
    const p = {
      id: row.id,
      title: row.title,
      description: row.description,
      type: row.type,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assetCount: Number(row.asset_count ?? 0),
    };
    if (includeState) p.state = JSON.parse(row.state);
    return p;
  }

  function assetJson(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      url: `/api/assets/${row.id}`,
      createdAt: row.created_at,
    };
  }

  function loadProject(id) {
    const row = isUuid(id) ? q.getProject.get(id) : undefined;
    if (!row) throw new HttpError(404, '프로젝트를 찾을 수 없습니다.', 'NOT_FOUND');
    return row;
  }

  function assetPath(file) {
    if (!ASSET_FILE_RE.test(file)) throw new Error('invalid asset file name in database');
    return path.join(assetsDir, file);
  }

  async function writeAssetFile(id, mime, bytes) {
    const file = `${id}.${IMAGE_MIMES[mime]}`;
    const tmp = path.join(assetsDir, `.tmp-${id}`);
    await fsp.writeFile(tmp, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await fsp.rename(tmp, assetPath(file));
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    return file;
  }

  async function removeFiles(files) {
    for (const f of files) {
      try {
        await fsp.rm(assetPath(f), { force: true });
      } catch (err) {
        logger.error?.(`[studio] 이미지 파일 정리 실패: ${f} (${err.code || err.name})`);
      }
    }
  }

  function rejectUnknownBodyKeys(body, allowed) {
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) {
        throw new HttpError(400, `요청에 알 수 없는 항목 '${key.slice(0, 40)}'이(가) 있습니다.`, 'VALIDATION_ERROR');
      }
    }
  }

  function methodNotAllowed(allowed) {
    return new HttpError(405, '허용되지 않은 요청 방식입니다.', 'METHOD_NOT_ALLOWED', { Allow: allowed.join(', ') });
  }

  // ---------- route handlers ----------
  async function handleSetup(req, res) {
    // First-owner claim is only accepted from the local machine.
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      throw new HttpError(403, '최초 소유자 설정은 이 컴퓨터(로컬)에서만 할 수 있습니다.', 'SETUP_LOCAL_ONLY');
    }
    const body = await readJson(req, BODY_LIMITS.small);
    if (hasOwner()) throw new HttpError(409, '이미 소유자 계정이 설정되어 있습니다. 로그인해 주세요.', 'SETUP_ALREADY_DONE');
    rejectUnknownBodyKeys(body, ['name', 'email', 'password']);
    const { name, email, password } = validateSetup(body);
    const passwordHash = await hashPassword(password);
    let cookie;
    transaction(db, () => {
      // Recheck atomically inside the write transaction.
      if (q.ownerCount.get().n > 0) {
        throw new HttpError(409, '이미 소유자 계정이 설정되어 있습니다. 로그인해 주세요.', 'SETUP_ALREADY_DONE');
      }
      q.insertOwner.run(name, email, passwordHash, nowIso());
      cookie = createSessionCookie(1);
    });
    sendJson(res, 201, { user: { name, email } }, { 'Set-Cookie': cookie });
  }

  async function handleLogin(req, res) {
    const body = await readJson(req, BODY_LIMITS.small);
    const clientKey = req.socket.remoteAddress || 'unknown';
    const wait = throttle.check(clientKey);
    if (wait > 0) {
      const sec = Math.ceil(wait / 1000);
      throw new HttpError(429, `로그인 시도가 너무 많습니다. ${sec}초 후에 다시 시도해 주세요.`, 'LOGIN_THROTTLED', {
        'Retry-After': String(sec),
      });
    }
    const { email, password } = validateLogin(body);
    const owner = q.owner.get();
    if (!owner) {
      await verifyPassword(password, await dummyHash());
      throw new HttpError(409, '아직 소유자 계정이 없습니다. 최초 설정을 먼저 진행해 주세요.', 'SETUP_REQUIRED');
    }
    throttle.fail(clientKey); // provisional, undone on success
    const passOk = await verifyPassword(password, owner.password_hash);
    if (!passOk || email !== owner.email) {
      throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.', 'INVALID_CREDENTIALS');
    }
    throttle.succeed(clientKey);
    const cookie = createSessionCookie(owner.id);
    sendJson(res, 200, { user: publicUser(owner) }, { 'Set-Cookie': cookie });
  }

  async function handleLogout(req, res) {
    await readJson(req, BODY_LIMITS.small);
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (token && token.length <= 128) q.deleteSession.run(hashToken(token));
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
  }

  async function handleCreateProject(req, res) {
    requireUser(req);
    const body = await readJson(req, BODY_LIMITS.project);
    rejectUnknownBodyKeys(body, ['title', 'description', 'type']);
    const title = validateTitle(body.title);
    const description = body.description === undefined ? '' : validateDescription(body.description);
    const type = body.type === undefined ? 'other' : validateType(body.type);
    const id = randomUUID();
    const ts = nowIso();
    transaction(db, () => {
      if (q.projectCount.get().n >= MAX_PROJECTS) {
        throw new HttpError(409, `프로젝트는 최대 ${MAX_PROJECTS}개까지 만들 수 있습니다.`, 'PROJECT_LIMIT');
      }
      q.insertProject.run(id, title, description, type, JSON.stringify(defaultState()), ts, ts);
    });
    sendJson(res, 201, { project: projectJson(q.getProject.get(id), true) });
  }

  async function handlePatchProject(req, res, id) {
    requireUser(req);
    const body = await readJson(req, BODY_LIMITS.patch);
    rejectUnknownBodyKeys(body, ['version', 'title', 'description', 'type', 'state']);
    const version = validateVersion(body.version);
    const changes = {};
    if (body.title !== undefined) changes.title = validateTitle(body.title);
    if (body.description !== undefined) changes.description = validateDescription(body.description);
    if (body.type !== undefined) changes.type = validateType(body.type);
    if (body.state !== undefined) changes.state = JSON.stringify(validateState(body.state));
    if (Object.keys(changes).length === 0) {
      throw new HttpError(400, '변경할 항목이 없습니다.', 'VALIDATION_ERROR');
    }
    transaction(db, () => {
      const row = loadProject(id);
      if (row.version !== version) {
        throw new HttpError(
          409,
          '다른 곳에서 먼저 저장된 내용이 있습니다. 화면의 수정 내용은 유지되었으니 최신 내용을 확인한 뒤 다시 저장해 주세요.',
          'VERSION_CONFLICT',
        );
      }
      const result = q.updateProject.run(
        changes.title ?? row.title,
        changes.description ?? row.description,
        changes.type ?? row.type,
        changes.state ?? row.state,
        nowIso(),
        id,
        version,
      );
      if (Number(result.changes) !== 1) {
        throw new HttpError(409, '다른 곳에서 먼저 저장된 내용이 있습니다.', 'VERSION_CONFLICT');
      }
    });
    sendJson(res, 200, { project: projectJson(q.getProject.get(id), true) });
  }

  async function handleDeleteProject(req, res, id) {
    requireUser(req);
    let files = [];
    transaction(db, () => {
      loadProject(id);
      files = q.listAssets.all(id).map((a) => a.file);
      q.deleteProject.run(id);
    });
    await removeFiles(files);
    sendJson(res, 200, { ok: true });
  }

  async function handleUploadAsset(req, res, projectId) {
    requireUser(req);
    loadProject(projectId);
    const body = await readJson(req, BODY_LIMITS.asset);
    rejectUnknownBodyKeys(body, ['name', 'mime', 'data']);
    const img = validateImagePayload(body);
    if (q.assetCount.get(projectId).n >= LIMITS.assetsPerProjectMax) {
      throw new HttpError(409, `프로젝트당 이미지는 최대 ${LIMITS.assetsPerProjectMax}개까지 보관할 수 있습니다.`, 'ASSET_LIMIT');
    }
    const id = randomUUID();
    const file = await writeAssetFile(id, img.mime, img.bytes);
    try {
      transaction(db, () => {
        loadProject(projectId);
        if (q.assetCount.get(projectId).n >= LIMITS.assetsPerProjectMax) {
          throw new HttpError(409, `프로젝트당 이미지는 최대 ${LIMITS.assetsPerProjectMax}개까지 보관할 수 있습니다.`, 'ASSET_LIMIT');
        }
        q.insertAsset.run(id, projectId, img.name, img.mime, img.bytes.length, file, nowIso());
      });
    } catch (err) {
      await removeFiles([file]);
      throw err;
    }
    sendJson(res, 201, { asset: assetJson(q.getAsset.get(id)) });
  }

  async function handleGetAsset(req, res, id, url) {
    requireUser(req);
    const row = isUuid(id) ? q.getAsset.get(id) : undefined;
    if (!row) throw new HttpError(404, '이미지를 찾을 수 없습니다.', 'NOT_FOUND');
    const file = assetPath(row.file);
    let stat;
    try {
      stat = await fsp.stat(file);
    } catch {
      throw new HttpError(404, '이미지 파일을 찾을 수 없습니다.', 'ASSET_FILE_MISSING');
    }
    const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const fallback = `image.${IMAGE_MIMES[row.mime]}`;
    res.writeHead(200, {
      ...API_SECURITY_HEADERS,
      'Cache-Control': 'private, no-cache',
      'Content-Type': row.mime,
      'Content-Length': stat.size,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  async function handleDeleteAsset(req, res, id) {
    requireUser(req);
    let file;
    transaction(db, () => {
      const row = isUuid(id) ? q.getAsset.get(id) : undefined;
      if (!row) throw new HttpError(404, '이미지를 찾을 수 없습니다.', 'NOT_FOUND');
      file = row.file;
      q.deleteAsset.run(id);
    });
    await removeFiles([file]);
    sendJson(res, 200, { ok: true });
  }

  async function handleExport(req, res, id) {
    requireUser(req);
    const row = loadProject(id);
    const assets = q.listAssets.all(id);
    const rawTotal = assets.reduce((s, a) => s + a.size, 0);
    const estimate = Math.ceil(rawTotal / 3) * 4 + Buffer.byteLength(row.state) + 64 * KiB;
    const tooLarge = () =>
      new HttpError(413, '백업 파일이 50MiB를 초과하여 만들 수 없습니다. 이미지 수를 줄인 뒤 다시 시도해 주세요.', 'BACKUP_TOO_LARGE');
    if (estimate > LIMITS.backupBytesMax) throw tooLarge();
    const outAssets = [];
    for (const a of assets) {
      let bytes;
      try {
        bytes = await fsp.readFile(assetPath(a.file));
      } catch {
        throw new HttpError(409, `이미지 파일 '${a.name}'을(를) 찾을 수 없어 백업을 만들 수 없습니다.`, 'ASSET_FILE_MISSING');
      }
      outAssets.push({ id: a.id, name: a.name, mime: a.mime, data: bytes.toString('base64') });
    }
    const backup = {
      format: 'personal-studio-backup',
      version: 1,
      project: { title: row.title, description: row.description, type: row.type, state: JSON.parse(row.state) },
      assets: outAssets,
    };
    const payload = Buffer.from(JSON.stringify(backup), 'utf8');
    if (payload.length > LIMITS.backupBytesMax) throw tooLarge();
    const date = new Date().toISOString().slice(0, 10);
    const fallback = `personal-studio-backup-${date}.json`;
    res.writeHead(200, {
      ...API_SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': payload.length,
      'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(`${row.title}-${date}.json`)}`,
    });
    res.end(payload);
  }

  async function handleImport(req, res) {
    requireUser(req);
    const body = await readJson(req, BODY_LIMITS.import);
    const backup = validateBackup(body); // full validation before any write
    const projectId = randomUUID();
    const idMap = new Map();
    const written = [];
    const records = [];
    try {
      for (const a of backup.assets) {
        const newId = randomUUID();
        idMap.set(a.oldId, newId);
        const file = await writeAssetFile(newId, a.mime, a.bytes);
        written.push(file);
        records.push({ id: newId, name: a.name, mime: a.mime, size: a.bytes.length, file });
      }
      const state = backup.state;
      if (state.editor.baseAssetId !== null) state.editor.baseAssetId = idMap.get(state.editor.baseAssetId) ?? null;
      const ts = nowIso();
      transaction(db, () => {
        if (q.projectCount.get().n >= MAX_PROJECTS) {
          throw new HttpError(409, `프로젝트는 최대 ${MAX_PROJECTS}개까지 만들 수 있습니다.`, 'PROJECT_LIMIT');
        }
        q.insertProject.run(projectId, backup.title, backup.description, backup.type, JSON.stringify(state), ts, ts);
        for (const r of records) q.insertAsset.run(r.id, projectId, r.name, r.mime, r.size, r.file, ts);
        testHooks?.beforeImportCommit?.();
      });
    } catch (err) {
      await removeFiles(written);
      throw err;
    }
    sendJson(res, 201, { project: projectJson(q.getProject.get(projectId), true) });
  }

  // ---------- router ----------
  async function handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    if (STATE_CHANGING.has(method)) checkOrigin(req);

    if (pathname === '/api/ai' || pathname.startsWith('/api/ai/')) {
      requireUser(req);
      sendJson(res, 501, AI_NOT_CONFIGURED);
      return;
    }

    if (pathname === '/api/health') {
      if (method !== 'GET') throw methodNotAllowed(['GET']);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (pathname === '/api/status') {
      if (method !== 'GET') throw methodNotAllowed(['GET']);
      const user = getSessionUser(req);
      sendJson(res, 200, {
        setupRequired: !hasOwner(),
        authenticated: Boolean(user),
        user: user ? publicUser(user) : null,
        ai: { configured: false },
        storage: 'server',
        deployment: 'local',
      });
      return;
    }
    if (pathname === '/api/setup') {
      if (method !== 'POST') throw methodNotAllowed(['POST']);
      return handleSetup(req, res);
    }
    if (pathname === '/api/login') {
      if (method !== 'POST') throw methodNotAllowed(['POST']);
      return handleLogin(req, res);
    }
    if (pathname === '/api/logout') {
      if (method !== 'POST') throw methodNotAllowed(['POST']);
      return handleLogout(req, res);
    }
    if (pathname === '/api/import') {
      if (method !== 'POST') throw methodNotAllowed(['POST']);
      return handleImport(req, res);
    }
    if (pathname === '/api/projects') {
      if (method === 'GET') {
        requireUser(req);
        sendJson(res, 200, { projects: q.listProjects.all().map((r) => projectJson(r, false)) });
        return;
      }
      if (method === 'POST') return handleCreateProject(req, res);
      throw methodNotAllowed(['GET', 'POST']);
    }
    let m = /^\/api\/projects\/([^/]+)$/.exec(pathname);
    if (m) {
      const id = m[1];
      if (method === 'GET') {
        requireUser(req);
        sendJson(res, 200, { project: projectJson(loadProject(id), true) });
        return;
      }
      if (method === 'PATCH') return handlePatchProject(req, res, id);
      if (method === 'DELETE') return handleDeleteProject(req, res, id);
      throw methodNotAllowed(['GET', 'PATCH', 'DELETE']);
    }
    m = /^\/api\/projects\/([^/]+)\/assets$/.exec(pathname);
    if (m) {
      const id = m[1];
      if (method === 'GET') {
        requireUser(req);
        loadProject(id);
        sendJson(res, 200, { assets: q.listAssets.all(id).map(assetJson) });
        return;
      }
      if (method === 'POST') return handleUploadAsset(req, res, id);
      throw methodNotAllowed(['GET', 'POST']);
    }
    m = /^\/api\/projects\/([^/]+)\/export$/.exec(pathname);
    if (m) {
      if (method !== 'GET') throw methodNotAllowed(['GET']);
      return handleExport(req, res, m[1]);
    }
    m = /^\/api\/assets\/([^/]+)$/.exec(pathname);
    if (m) {
      if (method === 'GET' || method === 'HEAD') return handleGetAsset(req, res, m[1], url);
      if (method === 'DELETE') return handleDeleteAsset(req, res, m[1]);
      throw methodNotAllowed(['GET', 'DELETE']);
    }
    throw new HttpError(404, '요청한 API를 찾을 수 없습니다.', 'NOT_FOUND');
  }

  function sendPlain(res, status, text, headers = {}) {
    const body = Buffer.from(text, 'utf8');
    res.writeHead(status, {
      ...PAGE_SECURITY_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(body);
  }

  async function handle(req, res) {
    let url;
    try {
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 2048) {
        throw new HttpError(400, '잘못된 요청 주소입니다.', 'BAD_REQUEST');
      }
      const hostname = hostnameOf(req.headers.host);
      if (!hostname || !allowedHostnames.has(hostname)) {
        throw new HttpError(421, '허용되지 않은 호스트 이름으로 접속했습니다.', 'HOST_NOT_ALLOWED');
      }
      url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendPlain(res, 405, '허용되지 않은 요청 방식입니다.', { Allow: 'GET, HEAD' });
        return;
      }
      const info = await resolveStatic(publicDir, url.pathname);
      if (!info) {
        sendPlain(res, 404, '찾을 수 없습니다.');
        return;
      }
      serveStaticFile(req, res, info);
    } catch (err) {
      const bodyPending = !req.complete;
      if (bodyPending && !res.headersSent) res.setHeader('Connection', 'close');
      if (url && !(url.pathname === '/api' || url.pathname.startsWith('/api/')) && err instanceof HttpError) {
        sendPlain(res, err.status, err.message, err.extraHeaders);
      } else {
        sendError(res, err, logger);
      }
      if (bodyPending) {
        // Do not keep reading an unwanted/oversized body; close shortly after the reply is flushed.
        res.on('finish', () => setTimeout(() => req.socket?.destroy(), 1000).unref());
        req.resume();
      }
    }
  }

  const server = http.createServer({ maxHeaderSize: 16 * KiB }, (req, res) => {
    handle(req, res).catch((err) => sendError(res, err, logger));
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 300_000;
  server.keepAliveTimeout = 5_000;

  let listening = false;
  let actualPort = port;

  return {
    server,
    db,
    config: Object.freeze({ dataDir: dataReal, publicDir, assetsDir, host, port, publicOrigin, secureCookies, cookieName }),
    get port() {
      return actualPort;
    },
    get url() {
      const h = host.includes(':') ? `[${host}]` : host;
      return `http://${h}:${actualPort}`;
    },
    listen() {
      if (!isLoopbackHost(host)) {
        if (!allowRemote) {
          return Promise.reject(
            new Error(
              `외부 접속 주소(HOST=${host})로 실행하려면 명시적 허용(STUDIO_ALLOW_REMOTE=1)이 필요합니다. 현재 단계는 로컬 전용입니다.`,
            ),
          );
        }
        if (!hasOwner()) {
          return Promise.reject(
            new Error('소유자 계정이 아직 없습니다. 먼저 127.0.0.1에서 실행해 최초 설정을 마친 뒤 외부 주소로 실행하세요.'),
          );
        }
      }
      return new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.off('error', onError);
          listening = true;
          actualPort = server.address().port;
          resolve({ url: this.url, port: actualPort });
        });
      });
    },
    async close() {
      if (listening) {
        await new Promise((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections?.();
        });
        listening = false;
      }
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}

// ---------- direct run ----------
function isDirectRun() {
  if (import.meta.main !== undefined) return import.meta.main === true;
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function main() {
  const env = process.env;
  let studio;
  try {
    studio = createStudioServer({
      dataDir: env.DATA_DIR || undefined,
      publicDir: env.PUBLIC_DIR || undefined,
      host: env.HOST || DEFAULT_HOST,
      port: parsePort(env.PORT, DEFAULT_PORT),
      publicOrigin: env.STUDIO_PUBLIC_ORIGIN || undefined,
      allowedHosts: env.STUDIO_ALLOWED_HOSTS ? env.STUDIO_ALLOWED_HOSTS.split(',').map((s) => s.trim()) : undefined,
      secureCookies: env.STUDIO_SECURE_COOKIES === '1' ? true : undefined,
      allowRemote: env.STUDIO_ALLOW_REMOTE === '1',
    });
    const { url } = await studio.listen();
    console.log(`나의 창작실 로컬 서버: ${url}`);
  } catch (err) {
    console.error(`서버를 시작하지 못했습니다: ${err?.message || err}`);
    try {
      await studio?.close();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
  const shutdown = async () => {
    await studio.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (isDirectRun()) main();
