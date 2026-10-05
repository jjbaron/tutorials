// Serves the page, the latest snapshot, and a server-sent event stream of new snapshots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export function createServer({ host, port, webDir, getSnapshot, log = () => {} }) {
  const clients = new Set();
  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/vendor/three.min.js': ['../vendor/three.min.js', 'application/javascript']
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/snapshot') {
      const s = getSnapshot();
      if (!s) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"first sync still running"}'); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(s));
    }
    if (url.pathname === '/api/health') {
      const s = getSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ready: !!s, version: s && s.version, sources: s && s.sources }));
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 5000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const f = files[url.pathname];
    if (f) {
      const p = path.join(webDir, f[0]);
      if (fs.existsSync(p)) { res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-store' }); return fs.createReadStream(p).pipe(res); }
      res.writeHead(404); return res.end(`Missing ${p}. Run: npm run build:web`);
    }
    res.writeHead(404); res.end('Not found');
  });
  // keep SSE connections alive through proxies
  const ping = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);
  server.on('close', () => clearInterval(ping));
  return {
    listen: () => new Promise(r => server.listen(port, host, () => { log(`Repo Yard on http://${host}:${port}`); r(); })),
    broadcast(snap) { const data = `event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`; for (const c of clients) c.write(data); },
    close: () => new Promise(r => { for (const c of clients) c.end(); server.close(() => r()); }),
    server
  };
}
