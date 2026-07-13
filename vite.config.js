import { defineConfig } from 'vite';

// Prod builds call /proxy.php?url= (the Apache/serve.js contract), which
// `vite preview` doesn't implement — its SPA fallback answers with index.html
// and every SPC fetch dies on res.json(). Mirror deploy/serve.js's proxy so
// preview behaves like the real host. Whitelist-only, same as serve.js.
const PROXY_ALLOWED_HOSTS = new Set(['www.spc.noaa.gov']);

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
          const upstream = await fetch(target, { signal: AbortSignal.timeout(15000) });
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

// SPC has no CORS headers — proxy in dev (same paths as the Website repo,
// so spc-api.js works unchanged).
export default defineConfig({
  plugins: [previewSpcProxy()],
  server: {
    proxy: {
      // Longer prefixes first — '/api/spc' would otherwise swallow these.
      '/api/spc-fire': {
        target: 'https://www.spc.noaa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spc-fire/, '/products/fire_wx'),
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
