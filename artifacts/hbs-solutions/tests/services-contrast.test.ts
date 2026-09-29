// Run with: pnpm --filter @workspace/hbs-solutions test:services-contrast
// Samples the rendered skyline behind the text, not just a CSS token or a static screenshot.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

process.env.PORT ??= '5179';
process.env.BASE_PATH ??= '/';

const root = fileURLToPath(new URL('../', import.meta.url));
const cities = ['riyadh', 'jeddah', 'jazan'] as const;
const channel = (value: number) => {
  const v = value / 255;
  return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
};
const luminance = (rgb: number[]) => .2126 * channel(rgb[0]) + .7152 * channel(rgb[1]) + .0722 * channel(rgb[2]);
const contrast = (a: number[], b: number[]) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + .05) / (darker + .05);
};

async function pixels(page: import('playwright').Page, screenshot: Buffer, box: { x: number; y: number; width: number; height: number }) {
  return page.evaluate(async ({ image, box }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${image}`)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const samples: number[][] = [];
    for (let y = Math.ceil(box.y + 4); y < box.y + box.height - 4; y += 8) {
      for (let x = Math.ceil(box.x + 4); x < box.x + box.width - 4; x += 8) {
        const i = (y * canvas.width + x) * 4;
        samples.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
    bitmap.close();
    return samples;
  }, { image: screenshot.toString('base64'), box });
}

const server = await createServer({
  root,
  server: { port: 0, host: '127.0.0.1', strictPort: false },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  const address = server.httpServer!.address();
  assert.ok(address && typeof address !== 'string');
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true });
  for (const reducedMotion of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    });
    try {
      for (const city of cities) {
        const page = await context.newPage();
        try {
          await page.goto(`http://127.0.0.1:${address.port}/services?city=${city}`, { waitUntil: 'domcontentloaded' });
          const active = page.locator(`.cs-scene[data-city="${city}"][data-active="true"]`);
          await active.locator('svg').first().waitFor({ state: 'attached' });
          await page.locator('.site-band .pub-intro-lead').waitFor({ state: 'visible' });
          await page.addStyleTag({ content: '.cs *, .site-band .pub-intro > * { animation: none !important; transition: none !important; }' });

          const lead = page.locator('.site-band .pub-intro-lead');
          const state = await page.evaluate((el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const scene = document.querySelector('.cs');
            const activeScene = document.querySelector('.cs-scene[data-active="true"]');
            const band = document.querySelector('.site-band');
            const expected = getComputedStyle(document.documentElement).getPropertyValue('--color-on-dark').trim();
            return {
              color: style.color,
              expected,
              box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              sceneHeight: scene?.getBoundingClientRect().height ?? 0,
              sceneOpacity: activeScene ? getComputedStyle(activeScene).opacity : '0',
              bandHeight: band?.getBoundingClientRect().height ?? 0,
              progress: document.querySelectorAll('.cs-progress').length,
            };
          }, await lead.elementHandle());
          const text = state.color.match(/\d+/g)?.slice(0, 3).map(Number);
          assert.ok(text && text.length === 3, `${city}: missing lead text color`);
          const expected = state.expected.match(/^#([0-9a-f]{6})$/i);
          assert.ok(expected, `${city}: invalid --color-on-dark token`);
          const lightText = [1, 3, 5].map((offset) => parseInt(expected[1].slice(offset - 1, offset + 1), 16));
          assert.deepEqual(text, lightText, `${city}: lead returned to muted/gray text`);
          assert.equal(state.sceneOpacity, '1', `${city}: scene is transparent`);
          assert.ok(state.sceneHeight >= 400 && state.bandHeight >= 400, `${city}: band or scene collapsed`);
          if (reducedMotion) assert.equal(state.progress, 0, `${city}: progress still animates with reduced motion`);

          // Remove only the letters so the screenshot contains the exact composited pixels
          // behind every part of the paragraph, including gradients and the city artwork.
          await page.addStyleTag({ content: '.site-band .pub-intro { visibility: hidden !important; }' });
          const skyline = await page.screenshot({ animations: 'disabled' });
          const backgrounds = await pixels(page, skyline, state.box);
          assert.ok(backgrounds.length > 50, `${city}: no phone-width text region sampled`);
          const minimum = Math.min(...backgrounds.map((background) => contrast(text, background)));
          assert.ok(minimum >= 4.5, `${city}, reduced motion ${reducedMotion}: worst lead contrast ${minimum.toFixed(2)}:1 (minimum 4.5:1)`);

          // A solid night fill can pass contrast while hiding the city altogether.
          // Compare the open side of the band with and without the artwork.
          const openSide = { x: 8, y: 180, width: 110, height: 160 };
          const withScene = await pixels(page, skyline, openSide);
          await page.addStyleTag({ content: '.cs-scene { visibility: hidden !important; }' });
          const withoutScene = await pixels(page, await page.screenshot({ animations: 'disabled' }), openSide);
          const difference = withScene.reduce((sum, rgb, index) =>
            sum + rgb.reduce((d, value, channelIndex) => d + Math.abs(value - withoutScene[index][channelIndex]), 0) / 3, 0) / withScene.length;
          assert.ok(difference >= 4, `${city}, reduced motion ${reducedMotion}: skyline is not visibly contributing (${difference.toFixed(1)} pixel levels)`);
          console.log(`${city}, reduced motion ${reducedMotion}: ${minimum.toFixed(2)}:1 minimum contrast, ${difference.toFixed(1)} skyline difference`);
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}