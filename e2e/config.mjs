// Settings → Config: export only what differs from the defaults, take out what was forgotten about, preview the file, save it, apply it to this
// device (what is left out goes back to its default); import a file with a preview of what would change and a choice of which to apply.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const server = await createServer({ root, server: { port: 5241, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('http://localhost:5241/');
  await page.waitForFunction(() => window.turbocutApp);
  const S = (fn, arg) => page.evaluate(fn, arg);
  const setting = (k) => S((key) => key.split('.').reduce((o, p) => o?.[p], window.turbocutApp.store.settings), k);

  // a few settings changed, one of them forgotten about
  await S(() => {
    const s = window.turbocutApp.store;
    s.updateSettings({ showHome: true, snapping: false, autosave: false, trackOrder: ['captions', 'video', 'audio'] });
    s.updateSettings((x) => (x.transcribe.lang = 'german'));
  });
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const dlg = page.locator('.settings');
  await dlg.waitFor();
  await page.locator('.settings-nav').getByRole('tab', { name: 'Config', exact: true }).click();
  const rows = () => page.locator('.config-list .config-row');
  assert.equal(await rows().count(), 4, 'only the four settings that differ from the defaults are listed');
  const text = await rows().allTextContents();
  assert.ok(text.some((t) => /Snap clips and edges.*off/.test(t)));
  assert.ok(text.some((t) => /Order of the timeline rows.*captions above video above audio/.test(t)));

  // the preview is the file; taking a setting out takes it out of the file
  await page.locator('.config-details summary').click();
  const preview = () => page.locator('.config-preview').textContent().then((t) => JSON.parse(t));
  assert.deepEqual(Object.keys((await preview()).settings).sort(), ['autosave', 'snapping', 'trackOrder', 'transcribe']);
  await rows().filter({ hasText: 'Keep the project file up to date' }).getByRole('checkbox').uncheck();
  assert.deepEqual(Object.keys((await preview()).settings).sort(), ['snapping', 'trackOrder', 'transcribe']);
  assert.match(await page.locator('.config-list ~ p, .config p.hint').filter({ hasText: 'of the 4 settings' }).first().textContent(), /3 of the 4 settings/);

  // save it: a download holding exactly that
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save config file' }).click()]);
  assert.equal(dl.suggestedFilename(), 'turbocut.conf');
  const saved = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  assert.equal(saved.format, 'turbocut.config');
  assert.deepEqual(saved.settings, { snapping: false, trackOrder: ['captions', 'video', 'audio'], transcribe: { lang: 'german' } });

  // apply it to this device: the one left out goes back to its default, after being told so
  await page.getByRole('button', { name: 'Apply this config to this instance' }).click();
  const ask = page.getByRole('dialog', { name: 'Apply this config here?' });
  assert.match(await ask.textContent(), /Keep the project file up to date \(now off\)/);
  await ask.getByRole('button', { name: 'Apply' }).click();
  assert.equal(await setting('autosave'), true, 'left out: back to the default');
  assert.equal(await setting('snapping'), false, 'kept');
  assert.equal(await setting('transcribe.lang'), 'german');
  assert.deepEqual(await setting('trackOrder'), ['captions', 'video', 'audio']);
  assert.equal(await rows().count(), 3, 'the list now has the three that are still changed');

  // import: a file with three settings, one of which this device already has
  const incoming = JSON.stringify({ format: 'turbocut.config', version: 1, settings: { snapping: false, waveforms: false, previewScale: 50, hotkeys: { split: ['Ctrl+B'] }, defaultFont: 123 } });
  const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose a config file…' }).click()]);
  await ch.setFiles({ name: 'other.conf', mimeType: 'application/json', buffer: Buffer.from(incoming) });
  const imp = page.locator('.config-row').filter({ hasText: '→' });
  await imp.first().waitFor();
  const lines = await imp.allTextContents();
  console.log('import preview:', lines.join(' | '));
  assert.equal(lines.length, 3, 'snapping is already off here, and a wrong value (the font) is ignored: three settings would change');
  assert.ok(lines.some((l) => /Show audio waveforms.*on → off/.test(l)));
  assert.ok(lines.some((l) => /Preview sharpness.*auto → 50/.test(l)));
  assert.ok(lines.some((l) => /Shortcut: .*none|Shortcut: Split/.test(l)));
  assert.equal(await setting('waveforms'), true, 'nothing is applied before the person says so');
  await imp.filter({ hasText: 'Preview sharpness' }).getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: 'Apply 2 settings' }).click();
  assert.equal(await setting('waveforms'), false);
  assert.equal(await setting('previewScale'), 'auto', 'the one that was unticked is not applied');
  assert.deepEqual(await setting('hotkeys.split'), ['Ctrl+B']);
  assert.equal(await setting('snapping'), false);
  assert.equal(await setting('transcribe.lang'), 'german', 'what the file does not mention stays');

  // a file that is not a config says so, and changes nothing
  const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose a config file…' }).click()]);
  await ch2.setFiles({ name: 'x.conf', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await page.getByText('That file is not a TurboCut config.').waitFor();
  assert.equal(await setting('waveforms'), false);

  // it survives a reload
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  assert.equal(await setting('waveforms'), false);
  assert.deepEqual(await setting('hotkeys.split'), ['Ctrl+B']);
  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log('config e2e passed');
} finally {
  await browser.close();
  await server.close();
}
