// Production static server + SPC proxy. No dependencies — plain node:http.
//
// Serves the built dist/ directory and implements the same /proxy.php?url=
// contract the Website's Apache host provides (spc-api.js calls it in prod
// builds), so the client code runs unchanged. Whitelist-only, 5-minute
// in-memory cache, because SPC/WPC/NWPS publish no CORS headers.
//
// Run: node deploy/serve.js [port]   (systemd: arklatex-serve.service)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 8080;
const DIST = join(fileURLToPath(import.meta.url), '../../dist');

const ALLOWED_HOSTS = new Set(['www.spc.noaa.gov', 'www.wpc.ncep.noaa.gov', 'api.water.noaa.gov']);
const PROXY_TTL_MS = 5 * 60 * 1000;
const proxyCache = new Map(); // url → { at, status, type, body }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

async function handleProxy(req, res, target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    res.writeHead(400).end('bad url');
    return;
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    res.writeHead(403).end('host not allowed');
    return;
  }

  const hit = proxyCache.get(target);
  if (hit && Date.now() - hit.at < PROXY_TTL_MS) {
    res.writeHead(hit.status, { 'content-type': hit.type }).end(hit.body);
    return;
  }

  try {
    // identity: WPC's server sometimes pairs a fresh geojson with a stale
    // EMPTY gzip variant (200, zero bytes) — asking for gzip gets nothing.
    const upstream = await fetch(target, {
      headers: { 'accept-encoding': 'identity' },
      signal: AbortSignal.timeout(15000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    // Cache misses too (404 during SPC product transitions) — retrying every
    // page poll would hammer SPC for nothing.
    proxyCache.set(target, { at: Date.now(), status: upstream.status, type, body });
    res.writeHead(upstream.status, { 'content-type': type }).end(body);
  } catch (err) {
    console.error('[proxy]', target, err.message);
    res.writeHead(502).end('upstream error');
  }
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/proxy.php') {
    return handleProxy(req, res, u.searchParams.get('url') || '');
  }

  let path = normalize(u.pathname).replace(/^([/\\])+/, '');
  if (path === '' || path === '.') path = 'index.html';
  const file = join(DIST, path);
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res
      .writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
      .end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[serve] dist on http://127.0.0.1:${PORT} (SPC proxy at /proxy.php)`);
});
