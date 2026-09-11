import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot, syncData } from './lib/sync.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4317);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/api/catalog') {
      const snapshot = await readSnapshot();
      const { rawHashes, ...publicSnapshot } = snapshot;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(publicSnapshot));
    }
    const relative = pathname === '/' ? 'index.html' : pathname.startsWith('/images/') ? `public${pathname}` : pathname.slice(1);
    const allowed = relative === 'index.html' || relative === 'favicon.svg' || /^src\/[\w-]+\.(js|css)$/.test(relative) || /^public\/images\/[\w.-]+$/.test(relative);
    const filename = path.resolve(root, relative);
    if (!allowed || !filename.startsWith(root + path.sep)) { res.writeHead(404); return res.end('Not found'); }
    const body = await readFile(filename);
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 400); res.end('File tidak ditemukan.'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Stella Studio siap di http://localhost:${port}`);
  if (process.env.AUTO_SYNC === 'false') return;
  const interval = Math.max(1, Number(process.env.SYNC_INTERVAL_HOURS) || 6) * 3600000;
  const update = () => syncData().then(s => console.log(`Sinkronisasi: ${s.status}; revisi ${s.revision}`)).catch(() => console.error('Sinkronisasi gagal; snapshot terakhir dipertahankan.'));
  readSnapshot().then(s => { if (!s.checkedAt || Date.now() - Date.parse(s.checkedAt) >= interval) update(); }).catch(() => console.error('Periksa file snapshot.'));
  const timer = setInterval(update, interval);
  timer.unref();
});
