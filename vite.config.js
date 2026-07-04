import { defineConfig } from 'vite';

// SPC has no CORS headers — proxy in dev (same paths as the Website repo,
// so spc-api.js works unchanged).
export default defineConfig({
  server: {
    proxy: {
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
