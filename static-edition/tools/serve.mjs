// Local static server that applies public/_headers exactly like Cloudflare Pages would,
// so CSP problems show up before deploy. No dependencies. Usage: node tools/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.argv[2] || process.env.PORT || 4400);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function readHeaders() {
  const out = {};
  const file = path.join(root, '_headers');
  if (!fs.existsSync(file)) return out;
  let inAll = false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { inAll = line.trim() === '/*'; continue; }
    if (!inAll) continue;
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const headers = readHeaders();
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end('bad request'); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || path.basename(file) === '_headers') { res.writeHead(404, headers).end('not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('not found'); return; }
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`정적 미리보기: http://127.0.0.1:${port}  (public/_headers 적용)`));
