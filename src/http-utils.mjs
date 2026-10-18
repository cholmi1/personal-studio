// HTTP helpers: JSON responses, bounded body reading, cookies, errors.

export const KiB = 1024;
export const MiB = 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message, code, extraHeaders) {
    super(message);
    this.status = status;
    this.code = code;
    this.extraHeaders = extraHeaders;
  }
}

export const API_SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    ...API_SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    ...headers,
  });
  res.end(payload);
}

export function sendError(res, err, logger) {
  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    const headers = { ...(err.extraHeaders || {}) };
    sendJson(res, err.status, body, headers);
    return;
  }
  // Never expose internal error details to clients.
  try {
    logger?.error?.(`[studio] 내부 오류: ${err?.stack || err}`);
  } catch {
    /* ignore logging failures */
  }
  sendJson(res, 500, { error: '서버 내부 오류가 발생했습니다.', code: 'INTERNAL_ERROR' });
}

/**
 * Read the request body with a strict byte limit.
 * Rejects early from Content-Length and while streaming.
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined) {
      const n = Number(declared);
      if (!Number.isFinite(n) || n < 0) {
        reject(new HttpError(400, '요청 길이 정보가 올바르지 않습니다.', 'BAD_REQUEST'));
        return;
      }
      if (n > limit) {
        reject(tooLarge(limit));
        return;
      }
    }
    const chunks = [];
    let size = 0;
    let done = false;
    const onData = (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        req.off('data', onData);
        reject(tooLarge(limit));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks, size));
    });
    req.on('error', (e) => {
      if (done) return;
      done = true;
      reject(e);
    });
    req.on('aborted', () => {
      if (done) return;
      done = true;
      reject(new HttpError(400, '요청이 중단되었습니다.', 'BAD_REQUEST'));
    });
  });
}

function tooLarge(limit) {
  const err = new HttpError(
    413,
    `요청 크기가 허용 한도(${formatBytes(limit)})를 초과했습니다.`,
    'PAYLOAD_TOO_LARGE',
    { Connection: 'close' },
  );
  err.oversize = true;
  return err;
}

export function formatBytes(n) {
  if (n >= MiB) return `${Math.round((n / MiB) * 10) / 10}MiB`;
  if (n >= KiB) return `${Math.round((n / KiB) * 10) / 10}KiB`;
  return `${n}B`;
}

export function isJsonContentType(header) {
  if (typeof header !== 'string') return false;
  const type = header.split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

export async function readJson(req, limit) {
  if (!isJsonContentType(req.headers['content-type'])) {
    // Drain nothing; reject before reading.
    throw new HttpError(415, 'Content-Type은 application/json 이어야 합니다.', 'UNSUPPORTED_MEDIA_TYPE');
  }
  const buf = await readBody(req, limit);
  if (buf.length === 0) return {};
  let value;
  try {
    value = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON 형식이 올바르지 않습니다.', 'INVALID_JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, '요청 본문은 JSON 객체여야 합니다.', 'INVALID_JSON');
  }
  return value;
}

export function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== 'string' || header.length > 8192) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || name in out) continue;
    out[name] = value;
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure }) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (typeof maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
