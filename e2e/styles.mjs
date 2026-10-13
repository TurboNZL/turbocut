// Style editor, default font, and style import/export with bundled fonts, in a desktop browser.
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const FONT = `${root}e2e/.media/TurboTestFont.ttf`;
const server = await createServer({ root, server: { port: 5207, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
const fresh = async () => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5207/');
  await page.waitForFunction(() => window.turbocutApp);
  return page;
};
const pick = async (page, click, path) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click()]);
  await chooser.setFiles(path);
};
/** Share of preview pixels close to `rgb`. */
const share = (page, rgb) => page.$eval('.style-preview', (c, rgb) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) < 24 && Math.abs(d[i + 1] - rgb[1]) < 24 && Math.abs(d[i + 2] - rgb[2]) < 24) n++;
  return n / (d.length / 4);
}, rgb);
const setColour = (page, label, value) => page.getByLabel(label, { exact: true }).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
try {
  const page = await fresh();
  await page.evaluate(async (b64) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await window.turbocutApp.importFont(new File([u], 'TurboTestFont.ttf'));
  }, readFileSync(FONT).toString('base64'));

  // ---- 1. the built-in style is read-only; duplicating makes an editable copy
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  await page.getByRole('button', { name: 'Edit styles…' }).click();
  await page.waitForSelector('.style-editor');
  assert.ok(await page.getByRole('button', { name: 'Duplicate to edit' }).isVisible(), 'built-in offers Duplicate to edit');
  assert.equal(await page.getByLabel('Style name').count(), 0, 'built-in has no editable fields');
  await page.getByRole('button', { name: 'Duplicate to edit' }).click();
  await page.getByLabel('Style name').waitFor();
  const name = await page.evaluate(() => window.turbocutApp.store.preset.name);
  assert.equal(name, 'TurboCut Bounce copy');
  assert.equal(await page.evaluate(() => !!window.turbocutApp.store.preset.builtin), false);

  // ---- 2. colour edits change the live preview (drawn by the real caption code) and the stored style
  await page.waitForTimeout(400); // entrance animation finished
  const whiteBefore = await share(page, [255, 255, 255]);
  await setColour(page, 'Fill', '#ff0000');
  const red = await share(page, [255, 0, 0]);
  const whiteAfter = await share(page, [255, 255, 255]);
  console.log('preview fill share: white', whiteBefore.toFixed(4), '->', whiteAfter.toFixed(4), ', red', red.toFixed(4));
  assert.ok(whiteBefore > 0.01, 'preview shows white text before');
  assert.ok(red > 0.01 && whiteAfter < whiteBefore / 4, 'preview turns red');
  assert.deepEqual(await page.evaluate(() => { const c = window.turbocutApp.store.preset.styles[0].primary; return [c.r, c.g, c.b]; }), [255, 0, 0]);
  await page.screenshot({ path: `${out}style-editor.png` });

  // ---- 3. variants: add, rename (captions using the old name follow), remove
  await page.evaluate(() => window.turbocutApp.store.edit((p) => p.captions.push({ id: 'c1', start: 0, end: 30, text: 'Hi', style: 'Default' })));
  await page.getByRole('button', { name: 'Add variant' }).click();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.preset.styles.length), 6);
  await page.getByLabel('Variant', { exact: true }).selectOption('0');
  await page.getByLabel('Variant name').fill('Hero');
  await page.getByLabel('Variant name').press('Enter');
  await page.getByLabel('Variant name').blur();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.project.captions[0].style), 'Hero', 'caption followed the rename');
  await page.getByLabel('Variant', { exact: true }).selectOption('5');
  await page.getByRole('button', { name: 'Remove variant' }).click();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.preset.styles.length), 5);

  // ---- 4. animation
  await page.getByLabel('Entrance').selectOption('none');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.preset.animation.type), 'none');
  await page.getByLabel('Entrance').selectOption('bounce');
  await page.getByLabel('Length (frames)').fill('10');
  await page.getByLabel('Length (frames)').blur();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.preset.animation.frames), 10);

  // ---- 5. the default font drives the built-in style
  await page.evaluate(() => window.turbocutApp.store.updateSettings({ defaultFont: 'Turbo Test Font' }));
  assert.equal(await page.evaluate(() => window.turbocutApp.store.presets[0].styles[0].fontname), 'Turbo Test Font');

  // ---- 6. export bundles the font by default, and leaves it out when asked
  await page.getByLabel('Variant', { exact: true }).selectOption('0');
  await page.getByLabel('Font', { exact: true }).fill('Turbo Test Font');
  await page.getByLabel('Font', { exact: true }).blur();
  const doExport = async (include) => {
    await page.getByRole('button', { name: 'Export…' }).click();
    await page.getByRole('dialog', { name: 'Export style' }).waitFor();
    const box = page.getByLabel('Include fonts');
    assert.equal(await box.isChecked(), true, 'fonts included by default');
    if (!include) await box.uncheck();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: 'Export style' }).getByRole('button', { name: 'Export' }).click()]);
    const path = `${out}${include ? 'with' : 'without'}-font.turbocut-preset.json`;
    await dl.saveAs(path);
    return path;
  };
  const withFont = await doExport(true);
  const without = await doExport(false);
  const a = JSON.parse(readFileSync(withFont, 'utf8'));
  const b = JSON.parse(readFileSync(without, 'utf8'));
  assert.ok(a.fonts?.length === 1 && a.fonts[0].families.includes('Turbo Test Font'), 'bundled file carries the font');
  assert.equal(b.fonts, undefined, 'optional exclude works');
  assert.ok(readFileSync(withFont).length > readFileSync(FONT).length, 'font bytes are in the file');
  assert.equal(a.builtin, undefined);

  // ---- 7. a fresh device (empty storage) gets the font from the file; without the bundle it has none
  const hasFont = (p) => p.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Turbo Test Font'));
  const other = await fresh();
  assert.equal(await hasFont(other), false, 'fresh device starts without the font');
  await other.getByRole('button', { name: 'Captions', exact: true }).click();
  await pick(other, () => other.getByRole('button', { name: 'Import style' }).click(), withFont);
  await other.waitForFunction(() => window.turbocutApp.store.preset.name.startsWith('TurboCut Bounce copy'));
  assert.equal(await hasFont(other), true, 'font installed from the preset');
  await other.reload();
  await other.waitForFunction(() => window.turbocutApp);
  await other.waitForFunction(() => [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Turbo Test Font'), null, { timeout: 5000 });
  const third = await fresh();
  await third.getByRole('button', { name: 'Captions', exact: true }).click();
  await pick(third, () => third.getByRole('button', { name: 'Import style' }).click(), without);
  await third.waitForFunction(() => window.turbocutApp.store.preset.name.startsWith('TurboCut Bounce copy'));
  assert.equal(await hasFont(third), false, 'no font without the bundle');

  // a corrupt file is reported, not crashed on
  await pick(third, () => third.getByRole('button', { name: 'Import style' }).click(), `${root}package.json`);
  await third.waitForFunction(() => /Not a usable style/.test(window.turbocutApp.store.status));
  assert.deepEqual(errors, []);
  console.log('styles e2e: ok');
} finally {
  await browser.close();
  await server.close();
}
