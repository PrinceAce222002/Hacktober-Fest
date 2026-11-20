// End-to-end check of the editor in a real browser.
//
// Usage: start the app (`npm run dev`), then `npm run test:e2e`.
// Env: APP_URL (default http://127.0.0.1:5173/), CHROME_PATH (optional system Chrome),
//      E2E_OUT (output dir, default e2e/output), E2E_VIDEO=1 to record a video.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const OUT = process.env.E2E_OUT ?? join(here, 'output');
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1440, height: 900 };

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

async function extract(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: join(pdfjsRoot, 'standard_fonts') + '/' });
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    pages.push({
      text: content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim(),
      rotation: page.rotate,
      ops: ops.fnArray,
    });
  }
  await task.destroy();
  return pages;
}

// A visible cursor for recordings.
const CURSOR_SCRIPT = `
  window.addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'background:rgba(239,68,68,.35);border:2px solid rgba(239,68,68,.9);pointer-events:none;z-index:2147483647;' +
      'transition:transform .08s;';
    document.body.appendChild(c);
    const move = (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', (e) => { move(e); c.style.transform = 'scale(.7)'; }, true);
    window.addEventListener('pointerup', () => { c.style.transform = 'scale(1)'; }, true);
  });
`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
});
const videoDir = join(OUT, 'video-raw');
const context = await browser.newContext({
  viewport: VIEWPORT,
  acceptDownloads: true,
  ...(process.env.E2E_VIDEO ? { recordVideo: { dir: videoDir, size: VIEWPORT } } : {}),
});
await context.addInitScript(CURSOR_SCRIPT);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const pause = (ms = 400) => page.waitForTimeout(ms);
async function hoverClick(locator, opts) {
  await locator.hover(opts);
  await pause(250);
  await locator.click(opts);
}

async function dragOnPage(pageIndex, from, to) {
  const overlay = page.locator('[data-testid="overlay"]').nth(pageIndex);
  const box = await overlay.boundingBox();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await pause(150);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
  await pause(300);
}

try {
  await page.goto(APP_URL);
  await page.getByText('Edit any PDF, right in your browser.').waitFor();
  await pause(600);
  await page.screenshot({ path: join(OUT, 'landing.png') });

  // Open the built-in sample.
  await hoverClick(page.getByTestId('sample'));
  await page.locator('[data-testid="text-run"][data-text="Quarterly Report"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('.page-shell:first-child .page-loading'));
  await pause(800);

  // 1) Edit existing text in place.
  await hoverClick(page.locator('[data-testid="text-run"][data-text="Quarterly Report"]'));
  const editor = page.getByTestId('text-editor');
  await editor.waitFor();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Annual Report 2026', { delay: 40 });
  await page.keyboard.press('Escape');
  await pause();
  // Restyle it: serif, italic, green.
  await page.getByTestId('font-family').selectOption('Times');
  await hoverClick(page.getByTestId('italic'));
  await page.getByTestId('text-color').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#047857');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pause();
  const edited = page.locator('.pages [data-testid="text-object"]', { hasText: 'Annual Report 2026' });
  assert.equal(await edited.count(), 1, 'edited text visible');
  await page.screenshot({ path: join(OUT, 'editing.png') });

  // 2) Delete an existing line of text.
  await hoverClick(page.locator('[data-testid="text-run"][data-text="Figures are unaudited."]'));
  await page.getByTestId('text-editor').waitFor();
  await page.keyboard.press('Escape');
  await hoverClick(page.getByTestId('delete-selection'));
  await pause();

  // 3) Erase a region (whiteout) over "Code: SAMPLE-001".
  const codeRun = page.locator('[data-testid="text-run"][data-text="Code: SAMPLE-001"]');
  const codeBox = await codeRun.boundingBox();
  const overlayBox = await page.locator('[data-testid="overlay"]').first().boundingBox();
  await hoverClick(page.locator('[data-tool="erase"]'));
  await dragOnPage(
    0,
    [codeBox.x - overlayBox.x - 4, codeBox.y - overlayBox.y - 3],
    [codeBox.x - overlayBox.x + codeBox.width + 4, codeBox.y - overlayBox.y + codeBox.height + 3],
  );

  // 4) Delete the original image.
  await hoverClick(page.locator('[data-tool="select"]'));
  await hoverClick(page.getByTestId('src-image').first());
  await hoverClick(page.getByTestId('delete-selection'));
  await pause();
  assert.equal(await page.getByTestId('src-image').count(), 0, 'image hidden after delete');

  // Scroll so the lower half of page 1 is visible for the next steps.
  await page.locator('.canvas-area').evaluate((el) => el.scrollTo({ top: 330 }));
  await pause(500);
  const ob = await page.locator('[data-testid="overlay"]').first().boundingBox();
  const visTop = 60 - ob.y; // overlay y of the top of the visible area (below the 60px top bar)
  const at = (fx, dy) => [ob.width * fx, visTop + dy];

  // 5) Add new text.
  await hoverClick(page.locator('[data-tool="text"]'));
  const [tx, ty] = at(0.1, 470);
  await page.mouse.move(ob.x + tx, ob.y + ty);
  await pause(200);
  await page.mouse.click(ob.x + tx, ob.y + ty);
  await page.getByTestId('text-editor').waitFor();
  await page.keyboard.type('Approved by J. Doe', { delay: 40 });
  await page.keyboard.press('Escape');
  await pause();
  await hoverClick(page.getByTestId('bold'));
  await page.getByTestId('font-size').fill('18');
  await pause();
  assert.equal(
    await page.locator('.pages [data-testid="text-object"]', { hasText: 'Approved by J. Doe' }).locator('.text-display').evaluate((el) => getComputedStyle(el).fontWeight),
    '700',
    'bold applied to new text',
  );

  // 6) Add a rectangle, test undo/redo.
  await hoverClick(page.locator('[data-tool="rect"]'));
  await dragOnPage(0, at(0.07, 430), at(0.5, 510));
  const rectCount = () => page.locator('.pages .obj-rect').count();
  assert.equal(await rectCount(), 1, 'rectangle added');
  await page.keyboard.press('ControlOrMeta+z');
  await pause();
  assert.equal(await rectCount(), 0, 'undo removes rectangle');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await pause();
  assert.equal(await rectCount(), 1, 'redo restores rectangle');

  // 7) Ellipse and line.
  await hoverClick(page.locator('[data-tool="ellipse"]'));
  await dragOnPage(0, at(0.6, 430), at(0.9, 520));
  await hoverClick(page.locator('[data-tool="line"]'));
  await dragOnPage(0, at(0.07, 560), at(0.9, 560));
  assert.equal(await page.locator('.pages .obj-ellipse').count(), 1, 'ellipse added');
  assert.equal(await page.locator('.pages .obj-line').count(), 1, 'line added');

  // 8) Insert an image (a screenshot of the app logo) and drag it into place.
  const logoPng = await page.locator('.topbar .logo').screenshot();
  await page.getByTestId('image-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logoPng });
  await page.locator('.pages .obj-image').waitFor();
  await pause();
  const img = page.locator('.pages .obj-image').first();
  await img.scrollIntoViewIfNeeded();
  const ib = await img.boundingBox();
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
  await page.mouse.down();
  await page.mouse.move(ib.x + ib.width / 2 + 160, ib.y + ib.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await pause();
  // Resize with the bottom-right handle.
  const se = img.locator('.handle-se');
  const hb = await se.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 60, hb.y + 60, { steps: 8 });
  await page.mouse.up();
  await pause();
  await page.locator('.canvas-area').evaluate((el) => el.scrollTo({ top: 0 }));
  await page.keyboard.press('Escape');
  await pause(500);
  await page.screenshot({ path: join(OUT, 'editor.png') });
  if (process.env.E2E_DEBUG) {
    console.log(await page.locator('.pages .obj').evaluateAll((els) => els.map((e) => `${e.className} ${e.getAttribute('style')}`)));
  }

  // 9) Page operations: delete page 3, rotate page 2, move page 2 to the top.
  await hoverClick(page.getByRole('button', { name: 'Delete page 3' }));
  await hoverClick(page.getByRole('button', { name: 'Rotate page 2 right' }));
  await hoverClick(page.getByRole('button', { name: 'Move page 2 up' }));
  await pause(800);
  assert.equal(await page.getByTestId('thumb').count(), 2);
  await page.screenshot({ path: join(OUT, 'pages.png') });

  // 10) Download.
  const [download] = await Promise.all([page.waitForEvent('download'), hoverClick(page.getByTestId('download'))]);
  const outPath = join(OUT, 'edited.pdf');
  await download.saveAs(outPath);
  await page.getByTestId('toast').waitFor();
  console.log('Toast:', await page.getByTestId('toast').innerText());
  await pause(800);

  // Verify the downloaded PDF.
  const pages = await extract(readFileSync(outPath));
  console.log(JSON.stringify(pages.map((p) => ({ text: p.text, rotation: p.rotation })), null, 2));
  assert.equal(pages.length, 2, 'two pages after deletion');
  assert.match(pages[0].text, /Page Two/, 'page 2 moved first');
  assert.equal(pages[0].rotation, 90, 'page rotated');
  const p1 = pages[1].text;
  assert.match(p1, /Annual Report 2026/);
  assert.doesNotMatch(p1, /Quarterly/);
  assert.doesNotMatch(p1, /Figures are unaudited/);
  assert.doesNotMatch(p1, /SAMPLE-001/);
  assert.match(p1, /Approved by J\. Doe/);
  assert.match(p1, /Prepared by the Example Company/);
  assert.match(p1, /Total revenue/);
  const imageOps = pages[1].ops.filter((op) => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length;
  assert.equal(imageOps, 1, 'original image removed, inserted image present');

  // 11) Re-open the edited PDF in the app to confirm it renders.
  await hoverClick(page.getByRole('button', { name: 'Open' }));
  await page.getByTestId('file-input').setInputFiles(outPath);
  await page.locator('[data-testid="text-run"][data-text="Annual Report 2026"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('.page-shell:first-child .page-loading'));
  await pause(800);
  await page.locator('.canvas-area').evaluate((el) => el.scrollTo({ top: el.scrollHeight / 2 }));
  await pause(800);
  await page.screenshot({ path: join(OUT, 'reopened.png') });

  const relevantErrors = errors.filter((e) => !/favicon/i.test(e));
  assert.deepEqual(relevantErrors, [], 'no console errors');
  console.log('E2E PASSED');
} finally {
  await context.close();
  if (process.env.E2E_VIDEO) {
    const v = page.video();
    if (v) writeFileSync(join(OUT, 'video-path.txt'), await v.path());
  }
  await browser.close();
}
