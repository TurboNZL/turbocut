// Layout manager: built-in layouts move the panel, resize the timeline and change control size; custom layouts are
// made, edited, saved, exported, imported and deleted; a narrow window always gets the bottom sheet.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5215, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5215/');
  await page.waitForFunction(() => window.turbocutApp);
  const box = (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const attrs = () => page.evaluate(() => ({ panel: document.getElementById('app').dataset.panel, density: document.getElementById('app').dataset.density }));
  const openLayout = async () => {
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.locator('.settings-nav').getByRole('tab', { name: 'Layout', exact: true }).click();
    await page.getByLabel('Layout', { exact: true }).waitFor();
  };
  const choose = (name) => page.getByLabel('Layout', { exact: true }).selectOption(name);

  assert.deepEqual(await attrs(), { panel: 'right', density: 'normal' }, 'automatic on a wide mouse screen');
  const sideRight = await box('.side');
  const preview = await box('.stage');
  assert.ok(sideRight.x > preview.x, 'panel right of the preview');

  await openLayout();
  await choose('Panel on the left');
  const sideLeft = await box('.side');
  assert.ok(sideLeft.x < (await box('.stage')).x, 'panel moved to the left');
  assert.equal((await attrs()).panel, 'left');

  const tlBefore = (await box('.bottom')).h;
  await choose('Tall timeline');
  const tlAfter = (await box('.bottom')).h;
  assert.ok(tlAfter > tlBefore * 1.3, `timeline grew (${tlBefore} -> ${tlAfter})`);

  await choose('Large controls');
  assert.equal((await attrs()).density, 'large');
  const btnH = await page.$eval('.edit-bar .btn', (el) => el.getBoundingClientRect().height);
  assert.ok(btnH >= 44, `large controls are at least 44 px (${btnH})`);

  await choose('Bottom sheet');
  assert.equal((await attrs()).panel, 'sheet');
  assert.ok((await box('.side')).y > (await box('.stage')).y, 'panel under the preview');

  // built-in layouts are read-only
  assert.equal(await page.getByLabel('Layout name').count(), 0);
  await page.getByRole('button', { name: 'Duplicate to edit' }).click();
  await page.getByLabel('Layout name').waitFor();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.layouts.length), 1);

  // edit the copy: left panel, narrow, move Media first
  await page.getByLabel('Layout name').fill('Mine');
  await page.getByLabel('Layout name').press('Tab');
  await page.getByLabel('Panel position').selectOption('left');
  await page.getByLabel('Panel width').fill('480');
  await page.getByRole('button', { name: 'Move Media up' }).click();
  const l = await page.evaluate(() => window.turbocutApp.store.settings.layouts[0]);
  assert.equal(l.name, 'Mine');
  assert.equal(l.panel, 'left');
  assert.equal(l.panelWidth, 480);
  assert.deepEqual(l.tabs, ['Media', 'Clip', 'Captions', 'Project']);
  await page.keyboard.press('Escape');
  await page.locator('.dlg .bt-close').click();
  const tabNames = await page.$$eval('.tabs .tab', (els) => els.map((e) => e.textContent));
  assert.deepEqual(tabNames, ['Media', 'Clip', 'Captions', 'Project'], 'the panel shows the chosen tabs in order');
  assert.ok(Math.abs((await box('.side')).w - 480) < 3, 'panel width applied');
  await page.screenshot({ path: `${out}layout-custom.png` });

  // survives a reload
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  assert.equal((await attrs()).panel, 'left');
  assert.deepEqual(await page.$$eval('.tabs .tab', (els) => els.map((e) => e.textContent)), ['Media', 'Clip', 'Captions', 'Project']);

  // export and import in a fresh browser profile
  await openLayout();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Export', exact: true }).click()]);
  const file = `${out}mine.turbocut-layout.json`;
  await dl.saveAs(file);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).layout.name, 'Mine');
  const other = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto('http://localhost:5215/');
  await other.waitForFunction(() => window.turbocutApp);
  await other.getByRole('button', { name: 'Settings' }).first().click();
  await other.locator('.settings-nav').getByRole('tab', { name: 'Layout', exact: true }).click();
  const [chooser] = await Promise.all([other.waitForEvent('filechooser'), other.getByRole('button', { name: 'Import…' }).click()]);
  await chooser.setFiles(file);
  await other.waitForFunction(() => window.turbocutApp.store.settings.layout === 'Mine');
  assert.equal(await other.evaluate(() => document.getElementById('app').dataset.panel), 'left');
  // a wrong file is refused, nothing changes
  writeFileSync(`${out}bad-layout.json`, '{"format":"nope"}');
  const [c2] = await Promise.all([other.waitForEvent('filechooser'), other.getByRole('button', { name: 'Import…' }).click()]);
  await c2.setFiles(`${out}bad-layout.json`);
  await other.waitForFunction(() => /Not a usable layout/.test(window.turbocutApp.store.status));
  assert.equal(await other.evaluate(() => window.turbocutApp.store.settings.layouts.length), 1);

  // delete returns to Automatic
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.layout), 'Automatic');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.layouts.length), 0);
  assert.equal((await attrs()).panel, 'right');

  // a narrow window always gets the sheet, even for a left-panel layout, and comes back when widened
  await choose('Panel on the left');
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForFunction(() => document.getElementById('app').dataset.panel === 'sheet');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => document.getElementById('app').dataset.panel === 'left');
  assert.deepEqual(errors, []);
  console.log('layouts e2e passed');
} finally {
  await browser.close();
  await server.close();
}
