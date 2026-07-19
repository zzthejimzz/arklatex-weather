import { defineConfig } from 'vite';

// Prod builds call /proxy.php?url= (the Apache/serve.js contract), which
// `vite preview` doesn't implement — its SPA fallback answers with index.html
// and every SPC fetch dies on res.json(). Mirror deploy/serve.js's proxy so
// preview behaves like the real host. Whitelist-only, same as serve.js.
const PROXY_ALLOWED_HOSTS = new Set(['www.spc.noaa.gov', 'www.wpc.ncep.noaa.gov', 'api.water.noaa.gov', 'www.pollen.com']);

// Pollen.com's keyless API 403s without a pollen.com Referer + browser
// User-Agent pair (both static — verified the root referer is enough).
const POLLEN_HEADERS = {
  referer: 'https://www.pollen.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
};

function previewSpcProxy() {
  return {
    name: 'preview-spc-proxy',
    configurePreviewServer(server) {
      server.middlewares.use('/proxy.php', async (req, res) => {
        const target = new URL(req.url, 'http://localhost').searchParams.get('url') || '';
        let url;
        try {
          url = new URL(target);
        } catch {
          res.statusCode = 400;
          return res.end('bad url');
        }
        if (url.protocol !== 'https:' || !PROXY_ALLOWED_HOSTS.has(url.hostname)) {
          res.statusCode = 403;
          return res.end('host not allowed');
        }
        try {
          // identity: WPC sometimes serves a stale EMPTY gzip variant next to
          // a fresh geojson — asking for gzip gets a 200 with zero bytes.
          const upstream = await fetch(target, {
            headers: {
              'accept-encoding': 'identity',
              ...(url.hostname === 'www.pollen.com' ? POLLEN_HEADERS : {}),
            },
            signal: AbortSignal.timeout(15000),
          });
          res.statusCode = upstream.status;
          res.setHeader('content-type', upstream.headers.get('content-type') || 'application/octet-stream');
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (err) {
          console.error('[preview proxy]', target, err.message);
          res.statusCode = 502;
          res.end('upstream error');
        }
      });
    },
  };
}

// SPC/WPC/NWPS all send no CORS headers — proxy in dev (same paths as the
// Website repo, so spc-api.js works unchanged).
export default defineConfig({
  plugins: [previewSpcProxy()],
  server: {
    proxy: {
      // Longer prefixes first — '/api/spc' would otherwise swallow these.
      '/api/nwps': {
        target: 'https://api.water.noaa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nwps/, '/nwps/v1/gauges'),
      },
      '/api/pollen': {
        target: 'https://www.pollen.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pollen/, '/api'),
        headers: POLLEN_HEADERS,
      },
      '/api/spc-fire': {
        target: 'https://www.spc.noaa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spc-fire/, '/products/fire_wx'),
      },
      '/api/wpc-ero': {
        target: 'https://www.wpc.ncep.noaa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/wpc-ero/, '/exper/eromap/geojson'),
        // WPC sometimes serves a stale EMPTY gzip variant next to a fresh
        // geojson (200, zero bytes) — force the uncompressed file.
        headers: { 'accept-encoding': 'identity' },
      },
      '/api/spc-ext': {
        target: 'https://www.spc.noaa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spc-ext/, '/products/exper/day4-8'),
      },
      '/api/spc': {
        target: 'https://www.spc.noaa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spc/, '/products/outlook'),
      },
    },
  },
});
