// Font manager: add a font file, see it listed and drawn, make it the default, remove it, spot a missing font.
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5213, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5213/');
  await page.waitForFunction(() => window.turbocutApp);
  const state = () => page.evaluate(() => ({ def: window.turbocutApp.store.settings.defaultFont, builtin: window.turbocutApp.store.presets[0].styles[0].fontname, loaded: [...document.fonts].map((f) => f.family.replace(/"/g, '')) }));

  await page.getByRole('tab', { name: 'Captions', exact: true }).click();
  await page.getByRole('button', { name: 'Fonts…' }).click();
  await page.getByRole('dialog', { name: 'Fonts' }).waitFor();
  await page.waitForFunction(() => /None yet/.test(document.querySelector('.font-manager')?.textContent ?? '')); // the list is read asynchronously

  // add: the file chooser path real users take
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add font files…' }).click()]);
  await chooser.setFiles(`${root}e2e/.media/TurboTestFont.ttf`);
  await page.locator('.font-row', { hasText: 'Turbo Test Font' }).waitFor();
  assert.ok((await state()).loaded.includes('Turbo Test Font'), 'registered with the page');
  const sampleFont = await page.locator('.font-row', { hasText: 'Turbo Test Font' }).locator('.font-sample').evaluate((el) => getComputedStyle(el).fontFamily);
  assert.match(sampleFont, /Turbo Test Font/, 'each font is shown drawn in itself');

  // adding the same file again replaces it instead of listing it twice
  const [again] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add font files…' }).click()]);
  await again.setFiles(`${root}e2e/.media/TurboTestFont.ttf`);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.font-row', { hasText: 'Turbo Test Font' }).count(), 1, 'no duplicate');

  // default: changes the built-in style
  await page.getByRole('button', { name: 'Use Turbo Test Font as the default font' }).click();
  await page.waitForFunction(() => window.turbocutApp.store.settings.defaultFont === 'Turbo Test Font');
  assert.equal((await state()).builtin, 'Turbo Test Font');
  assert.match(await page.locator('.font-row', { hasText: 'Turbo Test Font' }).textContent(), /default/);
  assert.match(await page.locator('.font-row', { hasText: 'Turbo Test Font' }).textContent(), /Used by TurboCut Bounce/, 'says where it is used');
  await page.screenshot({ path: `${out}font-manager.png` });

  // survives a reload (stored on the device)
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  await page.waitForFunction(() => [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Turbo Test Font'));

  // a style asking for a font this device lacks is reported
  await page.evaluate(() => { const s = window.turbocutApp.store; const p = s.duplicatePreset(s.presets[0]); p.styles[0].fontname = 'Nonexistent Display Face'; s.setPreset(p); });
  await page.getByRole('tab', { name: 'Captions', exact: true }).click();
  await page.getByRole('button', { name: 'Fonts…' }).click();
  await page.locator('.font-missing').waitFor();
  assert.match(await page.locator('.font-missing').textContent(), /Nonexistent Display Face/);

  // remove: gone from the page and the device, default falls back
  await page.getByRole('button', { name: 'Remove Turbo Test Font' }).click();
  await page.waitForFunction(() => ![...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Turbo Test Font'));
  const after = await state();
  assert.notEqual(after.def, 'Turbo Test Font', 'default no longer points at a removed font');
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  await page.waitForTimeout(500);
  assert.ok(!(await state()).loaded.includes('Turbo Test Font'), 'stays removed after a restart');
  assert.deepEqual(errors, []);
  console.log('fonts e2e passed');
} finally {
  await browser.close();
  await server.close();
}
