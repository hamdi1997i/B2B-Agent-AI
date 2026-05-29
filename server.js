'use strict';

/**
 * B2B Agent AI — zero-dependency web server.
 * Run with:  npm start   (or)   node server.js
 * Then open the printed URL. No API keys, no setup.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const agent = require('./src/agent');
const store = require('./src/store');
const { toCSV } = require('./src/export');
const { SECTORS } = require('./src/sectors');
const { ALL_NEEDS, ALL_DOMAINS } = require('./src/classify');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  const full = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  try {
    // ---- API ----
    if (p === '/api/config') {
      return sendJSON(res, 200, {
        sectors: SECTORS.map((s) => ({ key: s.key, label: s.label })),
        needs: ALL_NEEDS,
        domains: ALL_DOMAINS,
      });
    }

    if (p === '/api/collect' && req.method === 'POST') {
      const body = await readBody(req);
      const place = (body.place || '').trim();
      const sectorKeys = Array.isArray(body.sectors) ? body.sectors : [];
      if (!place) return sendJSON(res, 400, { error: 'Please enter a city / region.' });
      try {
        const job = await agent.run({
          place,
          sectorKeys,
          limit: Math.min(Number(body.limit) || 400, 2000),
          enrich: body.enrich !== false,
        });
        return sendJSON(res, 200, { ok: true, job });
      } catch (e) {
        return sendJSON(res, 400, { error: e.message });
      }
    }

    if (p === '/api/job') {
      return sendJSON(res, 200, { job: agent.getJob() });
    }

    if (p === '/api/companies') {
      const filters = {
        domain: u.searchParams.get('domain') || '',
        need: u.searchParams.get('need') || '',
        q: u.searchParams.get('q') || '',
        country: u.searchParams.get('country') || '',
        hasEmail: u.searchParams.get('hasEmail') === '1',
        hasPhone: u.searchParams.get('hasPhone') === '1',
        hasWebsite: u.searchParams.get('hasWebsite') === '1',
      };
      const rows = store.query(filters);
      const page = Math.max(1, Number(u.searchParams.get('page')) || 1);
      const pageSize = Math.min(Number(u.searchParams.get('pageSize')) || 50, 500);
      const start = (page - 1) * pageSize;
      return sendJSON(res, 200, {
        total: rows.length,
        page,
        pageSize,
        rows: rows.slice(start, start + pageSize),
      });
    }

    if (p === '/api/stats') {
      return sendJSON(res, 200, store.stats());
    }

    if (p === '/api/export') {
      const filters = {
        domain: u.searchParams.get('domain') || '',
        need: u.searchParams.get('need') || '',
        q: u.searchParams.get('q') || '',
        country: u.searchParams.get('country') || '',
        hasEmail: u.searchParams.get('hasEmail') === '1',
        hasPhone: u.searchParams.get('hasPhone') === '1',
        hasWebsite: u.searchParams.get('hasWebsite') === '1',
      };
      const rows = store.query(filters);
      const csv = toCSV(rows);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="b2b-targets.csv"',
      });
      return res.end(csv);
    }

    if (p === '/api/clear' && req.method === 'POST') {
      store.clear();
      return sendJSON(res, 200, { ok: true });
    }

    if (p.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'Unknown endpoint' });
    }

    // ---- Static files ----
    return serveStatic(req, res, p);
  } catch (e) {
    return sendJSON(res, 500, { error: e.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('\n  ┌───────────────────────────────────────────────┐');
  console.log('  │   B2B Agent AI is running                      │');
  console.log('  │                                               │');
  console.log(`  │   Open:  ${url.padEnd(37)}│`);
  console.log('  │                                               │');
  console.log('  │   No API keys needed. Just open & click Run.  │');
  console.log('  └───────────────────────────────────────────────┘\n');
});
