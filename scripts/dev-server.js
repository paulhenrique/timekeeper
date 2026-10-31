// Local dev server: serves the static files and the /api functions the way
// Vercel does (clean URLs, the /s/:id rewrite, req.query/req.body), with the
// in-memory store. No dependencies: `npm run dev`, then open http://localhost:3000
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const createSessions = require(path.join(ROOT, 'api/sessions/index.js'));
const sessionById = require(path.join(ROOT, 'api/sessions/[id].js'));

function vercelResponse(res) {
  return {
    setHeader: (key, value) => res.setHeader(key, value),
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(payload) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
      return this;
    },
  };
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

function serveFile(res, relative) {
  const file = path.join(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  if (pathname === '/api/sessions' || pathname.startsWith('/api/sessions/')) {
    const id = pathname.split('/')[3];
    const body = req.method === 'POST' ? await readJson(req) : undefined;
    const handler = id ? sessionById : createSessions;
    const query = { ...Object.fromEntries(url.searchParams), ...(id ? { id } : {}) };
    await handler({ method: req.method, headers: req.headers, query, body }, vercelResponse(res));
    return;
  }

  if (pathname === '/') return serveFile(res, 'index.html');
  if (/^\/s\/[^/]+$/.test(pathname)) return serveFile(res, 'session.html');
  if (!path.extname(pathname)) return serveFile(res, `${pathname}.html`);
  return serveFile(res, pathname);
});

server.listen(PORT, () => {
  console.log(`Timekeeper running at http://localhost:${PORT} (in-memory storage)`);
});
