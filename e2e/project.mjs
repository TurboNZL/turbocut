// Projects as files: save to .turbocut, open it in a fresh browser, find the media again, and export from the reopened project.
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5210, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
try {
  const newPage = async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:5210/');
    await page.waitForFunction(() => window.turbocutApp);
    return page;
  };
  const media = readFileSync(`${root}e2e/.media/src.webm`);
  const mediaFile = { name: 'clip.webm', mimeType: 'video/webm', buffer: media };

  // ---- a project with an import, a split and a text layer; saved with Ctrl+S
  const a = await newPage();
  await a.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.turbocutApp.importMedia([new File([bytes], 'clip.webm', { type: 'video/webm' })]);
    const s = window.turbocutApp.store;
    s.seek(120);
    window.turbocutApp.split();
    window.turbocutApp.actions.addText('Saved text');
    s.edit((p) => (p.name = 'My short'));
  }, media.toString('base64'));
  assert.equal(await a.evaluate(() => window.turbocutApp.store.dirty), true, 'edits make the project dirty');
  const before = await a.evaluate(() => JSON.parse(JSON.stringify(window.turbocutApp.store.project)));
  const [dl] = await Promise.all([a.waitForEvent('download'), a.keyboard.press('Control+s')]);
  assert.equal(dl.suggestedFilename(), 'My short.turbocut');
  const file = `${out}${dl.suggestedFilename()}`;
  await dl.saveAs(file);
  assert.equal(await a.evaluate(() => window.turbocutApp.store.dirty), false, 'saving clears the dirty flag');
  const text = readFileSync(file, 'utf8');
  assert.ok(!text.includes('AAAA'), 'the file holds the edit, not the media');
  assert.ok(text.length < 20000, `small file (${text.length} bytes)`);
  console.log('saved', dl.suggestedFilename(), text.length, 'bytes');

  // ---- a fresh browser: open it from the File menu
  const b = await newPage();
  await b.getByRole('button', { name: 'File' }).click();
  const [chooser] = await Promise.all([b.waitForEvent('filechooser'), b.getByRole('menuitem', { name: 'Open project…' }).click()]);
  await chooser.setFiles(file);
  await b.getByRole('dialog', { name: 'Find the media' }).waitFor();
  assert.deepEqual(await b.evaluate(() => JSON.parse(JSON.stringify(window.turbocutApp.store.project))), before, 'the same project came back');
  assert.equal(await b.evaluate(() => window.turbocutApp.store.missingAssets().map((x) => x.name).join()), 'clip.webm', 'the media is reported missing');
  assert.equal(await b.evaluate(() => window.turbocutApp.store.dirty), false);
  assert.match(await b.locator('.relink-list').textContent(), /clip\.webm/);

  // a wrong file matches nothing; the right one (same name) fills the gap and closes the dialog
  const [c1] = await Promise.all([b.waitForEvent('filechooser'), b.getByRole('button', { name: 'Choose files…' }).click()]);
  await c1.setFiles({ name: 'other.webm', mimeType: 'video/webm', buffer: media });
  await b.waitForFunction(() => /None of those files match/.test(window.turbocutApp.store.status));
  const [c2] = await Promise.all([b.waitForEvent('filechooser'), b.getByRole('button', { name: 'Choose files…' }).click()]);
  await c2.setFiles(mediaFile);
  await b.getByRole('dialog', { name: 'Find the media' }).waitFor({ state: 'detached' });
  assert.equal(await b.evaluate(() => window.turbocutApp.store.missingAssets().length), 0, 'nothing is missing any more');

  // the reopened project really plays and exports
  await b.evaluate(() => window.turbocutApp.store.seek(30));
  await b.waitForTimeout(600);
  const lit = await b.evaluate(() => { const c = window.turbocutApp.player.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 400) n += d[i] + d[i + 1] + d[i + 2] > 60 ? 1 : 0; return n / (d.length / 400); });
  assert.ok(lit > 0.2, `the preview shows the relinked video (lit share ${lit.toFixed(2)})`);
  const exp = await b.evaluate(async () => { const r = await window.turbocutApp.exportForTest(); return { frames: r.frames, bytes: r.bytes }; });
  assert.equal(exp.frames, 360, 'exports the whole 6 s at 60 fps');
  console.log('export from the reopened project:', JSON.stringify(exp));

  // ---- unsaved work is not thrown away silently
  await b.evaluate(() => window.turbocutApp.store.edit((p) => (p.name = 'Changed')));
  await b.getByRole('button', { name: 'File' }).click();
  await b.getByRole('menuitem', { name: 'New project' }).click();
  await b.getByRole('dialog', { name: 'Unsaved changes' }).waitFor();
  await b.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await b.evaluate(() => window.turbocutApp.store.project.name), 'Changed', 'Cancel keeps the project');
  await b.getByRole('button', { name: 'File' }).click();
  await b.getByRole('menuitem', { name: 'New project' }).click();
  await b.getByRole('button', { name: 'Discard them' }).click();
  assert.equal(await b.evaluate(() => window.turbocutApp.store.project.tracks.flatMap((t) => t.clips).length), 0, 'a new project is empty');

  // ---- a file that is not a project says so and changes nothing
  await b.getByRole('button', { name: 'File' }).click();
  const [c3] = await Promise.all([b.waitForEvent('filechooser'), b.getByRole('menuitem', { name: 'Open project…' }).click()]);
  await c3.setFiles({ name: 'notes.turbocut', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await b.waitForFunction(() => /not a TurboCut project/.test(window.turbocutApp.store.status));

  assert.deepEqual(errors, [], 'no page errors');
  console.log('project e2e passed');
} finally {
  await browser.close();
  await server.close();
}
