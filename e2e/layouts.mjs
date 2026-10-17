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
  const dlg = () => page.getByRole('dialog', { name: 'Settings' });
  const openLayout = async () => {
    if (!(await dlg().count())) await page.getByRole('button', { name: 'Settings' }).first().click();
    await dlg().locator('.settings-nav').getByRole('tab', { name: 'Layout', exact: true }).click();
    await dlg().locator('.layout-card').first().waitFor();
  };
  const choose = (name) => dlg().locator(`.layout-card[data-layout="${name}"]`).click();
  const layoutsSaved = () => page.evaluate(() => window.turbocutApp.store.settings.layouts.map((l) => l.name));

  assert.deepEqual(await attrs(), { panel: 'right', density: 'normal' }, 'automatic on a wide mouse screen');
  const sideRight = await box('.side');
  const preview = await box('.stage');
  assert.ok(sideRight.x > preview.x, 'panel right of the preview');
  assert.equal(await page.evaluate(() => document.getElementById('app').dataset.tools), 'top', 'the editing tools sit above the timeline with a mouse');
  assert.ok((await box('.edit-bar')).y < (await box('.bottom')).y, 'and really are above it');

  await openLayout();
  assert.equal(await dlg().locator('.layout-card').count(), 9, 'nine presets');
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

  // a preset is never edited: the first change saves a copy of it and switches to the copy
  assert.deepEqual(await layoutsSaved(), []);
  await dlg().getByLabel('Panel position').selectOption('left');
  assert.deepEqual(await layoutsSaved(), ['Bottom sheet (edited)'], 'editing a preset made your own copy');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.layout), 'Bottom sheet (edited)');
  assert.equal((await attrs()).panel, 'left');
  await page.evaluate(() => 0);
  assert.equal(await dlg().locator('.layout-card[data-layout="Bottom sheet"] .chip').count(), 0, 'the preset itself is still a preset');
  // a layout of your own is edited in place: rename, width, and arrange the panels
  await dlg().getByLabel('Layout name').fill('Mine');
  await dlg().getByLabel('Layout name').press('Tab');
  await dlg().getByLabel('Panel width').fill('480');
  await dlg().getByLabel('Media in panel 2').check();
  const l = await page.evaluate(() => window.turbocutApp.store.settings.layouts[0]);
  assert.equal(l.name, 'Mine');
  assert.equal(l.panel, 'left');
  assert.equal(l.panelWidth, 480);
  assert.deepEqual(l.panes, [['Clip', 'Captions', 'Project'], ['Media']], 'Media is in a panel of its own');
  assert.equal((await layoutsSaved()).length, 1, 'still one layout of yours');
  await page.locator('.dlg .bt-close').click();
  assert.equal(await page.locator('.side .pane').count(), 2, 'the side panel has two panes');
  assert.deepEqual(await page.$$eval('.side .pane:nth-child(1) .tab', (els) => els.map((e) => e.textContent)), ['Clip', 'Captions', 'Project']);
  assert.deepEqual(await page.$$eval('.side .pane:nth-child(3) .tab', (els) => els.map((e) => e.textContent)), ['Media'], 'the second pane has its own tab strip');
  assert.ok(Math.abs((await box('.side')).w - 480) < 8, 'panel width applied');
  await page.screenshot({ path: `${out}layout-custom.png` });

  // drag the bars: panel width, the pane divider, the timeline
  const edge = await box('.splitter-edge');
  await page.mouse.move(edge.x + edge.w / 2, edge.y + edge.h / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.w / 2 + 100, edge.y + edge.h / 2, { steps: 5 }); // left panel: dragging right widens it
  await page.mouse.up();
  const widened = await page.evaluate(() => window.turbocutApp.store.settings.layouts[0].panelWidth);
  console.log('panel width after dragging the bar 100 px:', widened);
  assert.ok(widened > 540 && widened <= 640, 'dragging the panel bar changes and saves the width');
  const sizes0 = await page.evaluate(() => window.turbocutApp.store.settings.layouts[0].paneSizes);
  const ps = await box('.splitter-pane');
  await page.mouse.move(ps.x + ps.w / 2, ps.y + ps.h / 2);
  await page.mouse.down();
  await page.mouse.move(ps.x + ps.w / 2, ps.y + ps.h / 2 - 60, { steps: 5 });
  await page.mouse.up();
  const sizes1 = await page.evaluate(() => window.turbocutApp.store.settings.layouts[0].paneSizes);
  console.log('pane sizes', sizes0, '->', sizes1);
  assert.ok(sizes1[0] < sizes0[0] && sizes1[1] > sizes0[1] && sizes1[0] + sizes1[1] === 100, 'dragging the divider between panes moves the share');
  const tlBar = await box('.splitter-timeline');
  const tlH0 = (await box('.bottom')).h;
  await page.mouse.move(tlBar.x + tlBar.w / 2, tlBar.y + tlBar.h / 2);
  await page.mouse.down();
  await page.mouse.move(tlBar.x + tlBar.w / 2, tlBar.y + tlBar.h / 2 - 80, { steps: 5 });
  await page.mouse.up();
  const tlH1 = (await box('.bottom')).h;
  assert.ok(tlH1 > tlH0 + 40, `dragging the timeline bar up makes it taller (${tlH0} -> ${tlH1})`);
  assert.ok((await page.evaluate(() => window.turbocutApp.store.settings.layouts[0].timelineHeight)) > 34, 'and saves it');

  // survives a reload
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  assert.equal((await attrs()).panel, 'left');
  assert.equal(await page.locator('.side .pane').count(), 2);

  // the dock layout: tabs along the bottom, Settings among them, and the gear opens that tab
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await openLayout();
  await choose('Bottom dock');
  await page.locator('.dlg .bt-close').click();
  assert.equal(await page.locator('.dock:visible').count(), 1, 'the dock shows');
  assert.deepEqual(await page.$$eval('.dock .bt-tab', (els) => els.map((e) => e.textContent)), ['Clip', 'Media', 'Captions', 'Project', 'Settings']);
  assert.equal(await page.locator('.dock .bt-tab[aria-current="page"]').textContent(), 'Clip');
  assert.equal(await page.locator('.pane > .tabs:visible').count(), 0, 'the panel has no tab strip of its own');
  await page.locator('.dock .bt-tab', { hasText: 'Media' }).click();
  assert.equal(await page.locator('.dock .bt-tab[aria-current="page"]').textContent(), 'Media');
  assert.ok(await page.locator('.bin:visible').count(), 'its page shows');
  await page.locator('.dock .bt-tab', { hasText: 'Settings' }).click();
  await page.locator('.settings-tab .settings-search').waitFor();
  console.log('dock bar box', JSON.stringify(await box('.dock')), 'bottom of window', await page.evaluate(() => innerHeight));
  await page.screenshot({ path: `${out}layout-dock.png` });
  // settings search inside the panel
  await page.locator('.settings-tab .settings-search').fill('snap');
  assert.ok(await page.locator('.settings-tab .settings-hit').getByText('Snap clips and edges').isVisible(), 'search finds the setting');
  assert.equal(await page.locator('.settings-tab .settings-hit:has-text("Fonts")').count(), 0, 'and shows only what matches');
  await page.locator('.settings-tab .settings-search').fill('');
  await page.getByRole('button', { name: 'Settings' }).first().click(); // the gear goes to the tab, no window
  assert.equal(await page.getByRole('dialog', { name: 'Settings' }).count(), 0, 'with a Settings tab the gear opens no window');

  // go back to the layout of yours for the share test
  await page.locator('.settings-tab .settings-nav').getByRole('tab', { name: 'Layout', exact: true }).click();
  await page.locator('.settings-tab .layout-card[data-layout="Mine"]').click();
  await page.evaluate(() => window.turbocutApp.store.updateSettings({ layout: 'Mine' }));
  await page.locator('.dock').waitFor({ state: 'hidden' });

  // export and import in a fresh browser profile
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await openLayout();
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg().getByRole('button', { name: 'Export this layout' }).click()]);
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
  await dlg().getByRole('button', { name: 'Delete', exact: true }).click();
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
