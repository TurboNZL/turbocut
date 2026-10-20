// Layouts: four presets; named panels left and right of the preview; where the editing tools sit; the bottom dock (Home, Edit, Settings);
// the phone layout keeps the timeline in view; custom layouts are made, edited, saved, exported, imported and deleted.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch, pick } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5215, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
const ignorable = (m) => /rate limit|status of 403|Failed to load resource/.test(m);
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !ignorable(m.text()) && errors.push(m.text()));
  await page.goto('http://localhost:5215/');
  await page.waitForFunction(() => window.turbocutApp);
  await page.waitForTimeout(600);
  const box = (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const attrs = () => page.evaluate(() => ({ panel: document.getElementById('app').dataset.panel, density: document.getElementById('app').dataset.density, tools: document.getElementById('app').dataset.tools }));
  const dlg = () => page.getByRole('dialog', { name: 'Settings' });
  const openLayout = async () => {
    if (!(await dlg().count())) await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await dlg().locator('.settings-nav').getByRole('tab', { name: 'Layout', exact: true }).click();
    await dlg().locator('.layout-card').first().waitFor();
  };
  const choose = (name) => dlg().locator(`.layout-card[data-layout="${name}"]`).click();
  const saved = () => page.evaluate(() => window.turbocutApp.store.settings.layouts);

  // ---- automatic: one panel on the right, Media first, tools in line with the play button
  assert.deepEqual(await attrs(), { panel: 'right', density: 'normal', tools: 'inline' }, 'automatic on a wide mouse screen');
  assert.ok((await box('.side-right')).x > (await box('.stage')).x, 'panel right of the preview');
  assert.equal(await page.locator('.side-left').isVisible(), false, 'nothing on the left');
  assert.equal(await page.locator('.side-right .tab[aria-selected="true"]').textContent(), 'Media', 'the first tab is Media, not Clip');
  assert.equal(await page.locator('.transport .edit-bar').count(), 1, 'the tools sit in the play button row');
  const play = await box('.transport-main');
  const split = await box('.edit-bar [aria-label="Split"]');
  assert.ok(Math.abs(play.y + play.h / 2 - (split.y + split.h / 2)) < 30, 'on the same row as play');
  assert.deepEqual(await page.$$eval('.edit-bar .tool:not(.fab-toggle)', (els) => els.map((e) => e.getAttribute('aria-label')).slice(0, 3)), ['Trim start', 'Split', 'Trim end'], 'Split sits between the two trim buttons');

  // ---- presets
  await openLayout();
  assert.equal(await dlg().locator('.layout-card').count(), 4, 'four presets');
  await choose('Library and editor');
  assert.ok((await box('.side-left')).x < (await box('.stage')).x, 'Library on the left');
  assert.ok((await box('.side-right')).x > (await box('.stage')).x, 'Editor on the right');
  assert.deepEqual(await page.$$eval('.pane-name', (els) => els.map((e) => e.textContent)), ['Library', 'Editor'], 'each panel shows its own name');
  assert.deepEqual(await page.$$eval('.side-left .tab', (els) => els.map((e) => e.textContent)), ['Media', 'Project']);
  await choose('Stacked panels');
  assert.equal(await page.locator('.side-right .pane').count(), 2, 'two panels stacked on one side');
  await choose('Bottom sheet');
  assert.equal((await attrs()).panel, 'sheet');
  assert.ok((await box('.side-right')).y > (await box('.stage')).y, 'panel under the preview');

  // a preset is never edited: the first change saves a copy of it and switches to the copy
  assert.deepEqual(await saved(), []);
  await pick(page, 'Position', 'float', dlg());
  const mine = await saved();
  assert.deepEqual(mine.map((l) => l.name), ['Bottom sheet (edited)'], 'editing a preset made your own copy');
  assert.equal(mine[0].tools, 'float');
  assert.equal((await attrs()).tools, 'float');
  await pick(page, 'Position', 'left', dlg());
  assert.equal((await attrs()).tools, 'left');
  const rail = await box('.stage > .edit-bar');
  const prev = await box('.stage .preview');
  assert.ok(rail.x + rail.w <= prev.x + 1 && rail.h > rail.w, 'a column left of the preview');
  await pick(page, 'Position', 'right', dlg());
  assert.ok((await box('.stage > .edit-bar')).x >= (await box('.stage .preview')).x, 'a column right of the preview');
  await pick(page, 'Position', 'auto', dlg());
  assert.equal((await attrs()).tools, 'inline', 'automatic is in line with the play button on a computer');

  // ---- panels: add one, name it, move it to the left, put a tab in it
  await pick(page, 'Panel position', 'auto', dlg());
  await dlg().getByLabel('Layout name').fill('Mine');
  await dlg().getByLabel('Layout name').press('Tab');
  assert.deepEqual((await saved()).map((l) => l.name), ['Mine']);
  await dlg().getByRole('button', { name: 'Add a panel' }).click();
  let l = (await saved())[0];
  assert.equal(l.divisions.length, 2, 'a second panel');
  const second = l.divisions[1].name;
  await dlg().getByLabel('Name of panel 2').fill('Tools');
  await dlg().getByLabel('Name of panel 2').press('Tab');
  await pick(page, 'Side of Tools', 'left', dlg());
  l = (await saved())[0];
  assert.deepEqual(l.divisions.map((d) => [d.name, d.side]), [['Panel', 'right'], ['Tools', 'left']], `renamed from "${second}" and moved to the left`);
  assert.deepEqual(l.divisions.flatMap((d) => d.tabs).sort(), ['Captions', 'Clip', 'Media', 'Project'], 'every tab is still in exactly one panel');
  await dlg().getByLabel('Project in Tools').check();
  l = (await saved())[0];
  assert.ok(l.divisions[1].tabs.includes('Project') && !l.divisions[0].tabs.includes('Project'), 'a tab moves from one panel to the other');
  await dlg().getByLabel('Right panel width').fill('480');
  await page.locator('.dlg .bt-close').click();
  assert.ok((await box('.side-left')).x < (await box('.stage')).x && (await box('.side-right')).x > (await box('.stage')).x, 'the two panels flank the preview');
  assert.ok(Math.abs((await box('.side-right')).w - 480) < 30, `right panel width applied (${(await box('.side-right')).w})`);
  await page.screenshot({ path: `${out}layout-custom.png` });

  // drag the bars: the right panel's edge and the timeline
  const edge = await box('.side-right .splitter-edge');
  await page.mouse.move(edge.x + edge.w / 2, edge.y + edge.h / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.w / 2 - 60, edge.y + edge.h / 2, { steps: 5 });
  await page.mouse.up();
  const widened = (await saved())[0].panelWidth;
  assert.ok(widened > 480 && widened <= 640, `dragging the bar left widens the right panel (${widened})`);
  const tlBar = await box('.splitter-timeline');
  const wholeBottom = await box('.bottom');
  assert.ok(tlBar.w >= wholeBottom.w - 2, `the timeline resize bar is as wide as the timeline (${tlBar.w} of ${wholeBottom.w})`);
  const tlH0 = wholeBottom.h;
  await page.mouse.move(tlBar.x + tlBar.w / 2, tlBar.y + tlBar.h / 2);
  await page.mouse.down();
  await page.mouse.move(tlBar.x + tlBar.w / 2, tlBar.y + tlBar.h / 2 - 80, { steps: 5 });
  await page.mouse.up();
  assert.ok((await box('.bottom')).h > tlH0 + 40, 'dragging the timeline bar up makes it taller');
  assert.ok((await saved())[0].timelineHeight > 34, 'and saves it');

  // survives a reload
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  await page.waitForTimeout(500);
  assert.ok(await page.locator('.side-left').isVisible() && (await page.locator('.pane-name').count()) === 2, 'the panels are back after a reload');

  // ---- the tool bar: other places
  const setTools = (tools) => page.evaluate((t) => window.turbocutApp.store.updateSettings((s) => (s.layouts[0].tools = t)), tools);
  await setTools('bottom');
  assert.equal((await attrs()).tools, 'bottom');
  assert.ok((await box('.edit-bar')).y > (await box('.bottom')).y, 'under the timeline');
  await setTools('float');
  assert.equal((await attrs()).tools, 'float');
  const fab = await box('.edit-bar');
  assert.ok(fab.x > 1280 - 120 && fab.y + fab.h > 800 - 30, `floating at the bottom right (${fab.x}, ${fab.y})`);
  await page.locator('.fab-toggle').click();
  assert.equal(await page.locator('.edit-bar [aria-label="Split"]').isVisible(), false, 'the round button hides the others');
  await page.locator('.fab-toggle').click();
  assert.equal(await page.locator('.edit-bar [aria-label="Split"]').isVisible(), true);
  await setTools('auto');

  // ---- the shortcut shown on a button is the one in force now
  assert.match(await page.locator('.edit-bar [aria-label="Split"]').getAttribute('title'), /\(S\)/);
  await page.evaluate(() => window.turbocutApp.hotkeys.setKeys('split', ['X']));
  assert.match(await page.locator('.edit-bar [aria-label="Split"]').getAttribute('title'), /\(X\)/, 'the tooltip follows the changed shortcut');
  await page.evaluate(() => window.turbocutApp.hotkeys.reset('split'));

  // ---- the dock is a setting: Home, Edit, Settings
  await page.evaluate(() => window.turbocutApp.store.updateSettings({ dock: true }));
  assert.equal(await page.locator('.dock:visible').count(), 1, 'the dock shows');
  assert.deepEqual(await page.$$eval('.dock .bt-tab', (els) => els.map((e) => e.textContent)), ['Home', 'Edit', 'Settings']);
  assert.equal(await page.locator('.dock .bt-tab[aria-current="page"]').textContent(), 'Edit');
  assert.equal(await page.locator('.pane > .tabs:visible').count() > 0, true, 'the panels keep their own tab strips');
  await page.locator('.dock .bt-tab', { hasText: 'Home' }).click();
  await page.locator('.home.docked').waitFor();
  const dockBox = await box('.dock');
  const homeBox = await box('.home');
  assert.ok(homeBox.y + homeBox.h <= dockBox.y + 2, 'the home page stops above the dock');
  await page.locator('.dock .bt-tab', { hasText: 'Settings' }).click();
  await page.locator('.view-layer .settings-search').waitFor();
  assert.equal(await page.locator('.home').count(), 0, 'one page at a time');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('settings-search')), true, 'typing starts a search at once');
  await page.screenshot({ path: `${out}layout-dock.png` });
  await page.locator('.view-layer .settings-search').fill('snap');
  assert.ok(await page.locator('.view-layer .settings-hit').getByText('Snap clips and edges').isVisible(), 'search finds the setting');
  await page.locator('.view-layer .settings-search').fill('');
  await page.locator('.dock .bt-tab', { hasText: 'Edit' }).click();
  assert.equal(await page.locator('.view-layer').count(), 0);
  // the window options live in Settings, Look
  await page.locator('.dock .bt-tab', { hasText: 'Settings' }).click();
  await page.locator('.view-layer .settings-nav').getByRole('tab', { name: 'Look', exact: true }).click();
  assert.ok(await page.getByLabel('Bottom dock with Home, Edit and Settings').isChecked(), 'the dock switch is in Settings');
  await page.getByLabel('Bottom dock with Home, Edit and Settings').uncheck();
  await page.locator('.dock').waitFor({ state: 'hidden' });
  await dlg().waitFor(); // turning it off while on the Settings page turns that page into the Settings window
  await page.locator('.dlg .bt-close').click();

  // the Settings window starts in the search box too
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('settings-search')), true, 'the search box has the focus when the window opens');
  await page.keyboard.type('waveform');
  assert.ok(await dlg().locator('.settings-hit').getByText('Show audio waveforms').isVisible(), 'typing right away searches');
  await page.locator('.dlg .bt-close').click();

  // ---- the first tab and tab switching are settings
  await openLayout();
  await pick(page, 'Tab that opens first', 'Captions', dlg());
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.openTab), 'Captions');
  await page.locator('.dlg .bt-close').click();
  await page.evaluate(() => window.turbocutApp.store.updateSettings({ openTab: 'Media' }));

  // ---- export and import in a fresh browser profile
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await openLayout();
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg().getByRole('button', { name: 'Export this layout' }).click()]);
  const file = `${out}mine.turbocut-layout.json`;
  await dl.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8')).layout;
  assert.equal(exported.name, 'Mine');
  assert.equal(exported.divisions.length, 2);
  const other = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto('http://localhost:5215/');
  await other.waitForFunction(() => window.turbocutApp);
  await other.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await other.locator('.settings-nav').getByRole('tab', { name: 'Layout', exact: true }).click();
  const [chooser] = await Promise.all([other.waitForEvent('filechooser'), other.getByRole('button', { name: 'Import…' }).click()]);
  await chooser.setFiles(file);
  await other.waitForFunction(() => window.turbocutApp.store.settings.layout === 'Mine');
  assert.equal(await other.locator('.side-left').isVisible(), true, 'the imported layout has its left panel');
  writeFileSync(`${out}bad-layout.json`, '{"format":"nope"}');
  const [c2] = await Promise.all([other.waitForEvent('filechooser'), other.getByRole('button', { name: 'Import…' }).click()]);
  await c2.setFiles(`${out}bad-layout.json`);
  await other.waitForFunction(() => /Not a usable layout/.test(window.turbocutApp.store.status));
  assert.equal(await other.evaluate(() => window.turbocutApp.store.settings.layouts.length), 1);

  // delete returns to Automatic
  await dlg().getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.layout), 'Automatic');
  assert.equal((await attrs()).panel, 'right');

  // a narrow window always gets the sheet, even for a two-sided layout, and comes back when widened
  await choose('Library and editor');
  await page.locator('.dlg .bt-close').click();
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForFunction(() => document.getElementById('app').dataset.panel === 'sheet');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => document.getElementById('app').dataset.panel === 'both');

  // ---- a phone: the preview, the timeline and the panel all stay on screen; the tools are centred
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.addInitScript(() => localStorage.setItem('turbocut.settings', JSON.stringify({ settingsVersion: 2, showHome: false })));
  await phone.goto('http://localhost:5215/');
  await phone.waitForFunction(() => window.turbocutApp);
  await phone.waitForTimeout(1500); // past the opening animation
  const pbox = (sel) => phone.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  assert.equal(await phone.evaluate(() => document.getElementById('app').dataset.tools), 'bottom');
  const closed = { stage: await pbox('.stage'), tl: await pbox('.bottom'), tools: await pbox('.edit-bar'), side: await pbox('.side-right') };
  assert.ok(closed.stage.h > 250, `closed: the preview gets the free space (${closed.stage.h})`);
  assert.ok(closed.tl.y + closed.tl.h <= closed.side.y + 1 && closed.side.y + closed.side.h <= 800 + 1, 'timeline above the panel strip, all inside the window');
  const toolButtons = await phone.$$eval('.edit-bar .tool:not(.fab-toggle)', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
  const mid = (Math.min(...toolButtons.map((b) => b[0])) + Math.max(...toolButtons.map((b) => b[1]))) / 2;
  assert.ok(Math.abs(mid - 195) < 14, `the tools are centred (${mid} vs 195)`);
  await phone.locator('.side-right .tab', { hasText: 'Project' }).click();
  await phone.waitForTimeout(500);
  const open = { stage: await pbox('.stage'), tl: await pbox('.bottom'), side: await pbox('.side-right') };
  assert.ok(open.tl.h >= 100 && open.tl.y + open.tl.h <= open.side.y + 1, `open: the timeline is still in view (${open.tl.h} px tall) above the panel`);
  assert.ok(open.stage.h >= 150, `open: the preview keeps a usable size (${open.stage.h})`);
  assert.ok(open.side.y + open.side.h <= 800 + 1, 'the open panel is inside the window');
  assert.ok(open.side.h >= 150, `and has room (${open.side.h})`);
  await phone.screenshot({ path: `${out}layout-phone-open.png` });
  // tools "above": a row just under the play bar, above the panel
  await phone.evaluate(() => window.turbocutApp.store.updateSettings((s) => { s.layouts.push({ name: 'T', panel: 'auto', panelWidth: 340, leftWidth: 300, timelineHeight: 34, density: 'auto', divisions: [{ name: 'Panel', side: 'right', tabs: ['Clip', 'Media', 'Captions', 'Project'], size: 100 }], tools: 'top' }); s.layout = 'T'; }));
  assert.equal(await phone.evaluate(() => document.getElementById('app').dataset.tools), 'stage');
  const tr = await pbox('.transport');
  const eb = await pbox('.stage > .edit-bar');
  assert.ok(eb.y >= tr.y + tr.h - 2, 'the tools are under the play bar');
  assert.ok(eb.y + eb.h <= (await pbox('.side-right')).y, 'and above the panel');
  // floating on a phone
  await phone.evaluate(() => window.turbocutApp.store.updateSettings((s) => (s.layouts[0].tools = 'float')));
  const pf = await pbox('.edit-bar');
  assert.ok(pf.x > 390 - 90, 'floating at the right edge of the phone');

  // ---- the desktop app draws its own title bar: nothing may sit over it or poke out above the editor, in any look, with the dock on
  for (const ui of ['gtk4', 'liquid']) {
    const framed = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    framed.on('pageerror', (e) => errors.push(e.message));
    await framed.addInitScript(() => {
      window.turbocut = { window: { customFrame: true, control() {}, setCustomFrame: async () => {}, onState() {} } };
      localStorage.setItem('turbocut.settings', JSON.stringify({ settingsVersion: 2, showHome: false, dock: true }));
    });
    await framed.goto('http://localhost:5215/');
    await framed.waitForFunction(() => window.turbocutApp);
    await framed.evaluate((u) => window.turbocutApp.themes.apply({ theme: 'light', ui: u }), ui);
    await framed.waitForTimeout(1500);
    const r = (sel) => framed.$eval(sel, (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; });
    const bar = await r('.bt-wf');
    const app = await r('#app');
    const header = await r('header.top');
    const dockNav = await r('.dock-nav');
    assert.ok(bar.top <= 0.5 && bar.bottom > 20, `${ui}: the title bar is at the very top (${bar.top}..${bar.bottom})`);
    assert.ok(app.top >= bar.bottom - 0.5, `${ui}: the editor starts under the title bar (${app.top} vs ${bar.bottom})`);
    assert.ok(header.top >= bar.bottom - 0.5, `${ui}: the editor's header does not poke over the title bar (${header.top} vs ${bar.bottom})`);
    assert.ok(app.bottom <= 800.5 && dockNav.bottom <= 800.5 && dockNav.top >= app.top, `${ui}: the dock stays inside the window (${dockNav.top}..${dockNav.bottom})`);
    await framed.locator('.dock .bt-tab', { hasText: 'Home' }).click();
    await framed.locator('.home.docked').waitFor();
    const home = await r('.home');
    assert.ok(home.top >= bar.bottom - 0.5, `${ui}: the home page starts under the title bar (${home.top})`);
    await framed.locator('.dock .bt-tab', { hasText: 'Settings' }).click();
    await framed.locator('.view-layer').waitFor();
    assert.ok((await r('.view-layer')).top >= bar.bottom - 0.5, `${ui}: so does the settings page`);
    await framed.screenshot({ path: `${out}frame-${ui}.png` });
    await framed.close();
  }

  assert.deepEqual(errors, []);
  console.log('layouts e2e passed');
} finally {
  await browser.close();
  await server.close();
}
