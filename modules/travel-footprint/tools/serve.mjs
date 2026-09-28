/* ==========================================================================
   tools/serve.mjs — static file server for the H5 build.
   Serves app/ on http://127.0.0.1:PORT with correct MIME types.
   Used for local development and by tools/e2e.mjs.

     node tools/serve.mjs [port]
   ========================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'app');
const PORT = Number(process.argv[2] || 5178);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.pdf': 'application/pdf'
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const p = path.normalize(path.join(root, decoded));
  if (!p.startsWith(root)) return null;   // path traversal guard
  return p;
}

const server = http.createServer((req, res) => {
  let target = safeJoin(ROOT, req.url || '/');
  if (!target) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(target, (err, st) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        .end('404 Not Found: ' + req.url);
      return;
    }
    if (st.isDirectory()) target = path.join(target, 'index.html');

    fs.readFile(target, (err2, buf) => {
      if (err2) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          .end('404 Not Found');
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
        // the app is fully offline; make that explicit for any auditor
        'cross-origin-opener-policy': 'same-origin'
      });
      res.end(buf);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[serve] http://127.0.0.1:${PORT}/  (root: ${ROOT})`);
});

export { server, PORT, ROOT };
