// Safe static file serving: only allowlisted extensions inside publicDir.
import { promises as fsp, createReadStream } from 'node:fs';
import path from 'node:path';

const STATIC_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
});

export const PAGE_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
    "font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; " +
    "frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
});

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Resolve a URL pathname to a file inside publicDir, or null when not allowed.
 * Rejects encoded separators, dot segments, hidden files and unknown extensions.
 */
export async function resolveStatic(publicRoot, pathname) {
  if (typeof pathname !== 'string' || pathname.length > 512) return null;
  // Encoded dots/separators/NUL are refused outright to avoid traversal tricks.
  if (/%2e|%2f|%5c|%00/i.test(pathname)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || !decoded.startsWith('/')) return null;
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  const segments = decoded.split('/').slice(1);
  if (segments.length === 0 || segments.length > 8) return null;
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg) || seg.includes('..')) return null;
  }
  const ext = path.extname(segments[segments.length - 1]).toLowerCase();
  if (!Object.hasOwn(STATIC_TYPES, ext)) return null;

  const candidate = path.resolve(publicRoot, ...segments);
  if (!isInside(publicRoot, candidate)) return null;
  let real;
  try {
    real = await fsp.realpath(candidate);
  } catch {
    return null;
  }
  // Symlink escape guard.
  if (!isInside(publicRoot, real)) return null;
  let stat;
  try {
    stat = await fsp.stat(real);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  return { file: real, size: stat.size, mtime: stat.mtime, type: STATIC_TYPES[ext] };
}

export function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function serveStaticFile(req, res, info) {
  res.writeHead(200, {
    ...PAGE_SECURITY_HEADERS,
    'Content-Type': info.type,
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
    'Last-Modified': info.mtime.toUTCString(),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(info.file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
