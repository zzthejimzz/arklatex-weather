import { expect, test } from '@playwright/test';

const FIXED_TIME = new Date('2026-07-19T18:00:00.000Z');
const STABLE_CAPTURE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    caret-color: transparent !important;
    transition: none !important;
  }
  #map .leaflet-map-pane { visibility: hidden !important; }
  .ticker-track { transform: translateX(0) !important; }
`;

const STATES = [
  { name: 'overview', query: 'visual-test' },
  { name: 'forecast', query: 'visual-test&panel' },
  { name: 'warning', query: 'visual-test&replay=visual-warning', selector: '.warn-card' },
  { name: 'almanac', query: 'visual-test&almanac' },
  { name: 'uv', query: 'visual-test&uv' },
  { name: 'aqi', query: 'visual-test&aqi' },
  { name: 'pollen', query: 'visual-test&pollen' },
  { name: 'aurora', query: 'visual-test&aurora' },
  { name: 'moon', query: 'visual-test&moon' },
];

test.describe('1920×1080 broadcast states', () => {
  for (const state of STATES) {
    test(state.name, async ({ page }) => {
      await page.clock.setFixedTime(FIXED_TIME);
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
      });

      await page.goto(`/?${state.query}`, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: STABLE_CAPTURE_CSS });

      const ready = state.selector
        ? page.locator(state.selector)
        : page.locator(`html[data-visual-ready="${state.name}"]`);
      await ready.waitFor({ state: state.selector ? 'visible' : 'attached' });

      const fontsLoaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return {
          manrope: document.fonts.check('16px Manrope'),
          mono: document.fonts.check('16px "JetBrains Mono"'),
        };
      });
      expect(fontsLoaded).toEqual({ manrope: true, mono: true });

      const stage = page.locator('#stage');
      expect(await stage.boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
      await expect(stage).toHaveScreenshot(`${state.name}.png`, {
        animations: 'disabled',
        maxDiffPixelRatio: 0.0005,
      });
    });
  }
});
