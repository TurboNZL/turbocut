// Projects live in files the person chose: the first Save asks where, the next ones write back to the same file, edits follow it a few seconds
// later (autosave), the home screen lists those files (never a copy of an edit), a new project is really new, and a file that went away says so.
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}e2e/.out/`, { recursive: true });
const server = await createServer({ root, server: { port: 5221, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
const media = readFileSync(`${root}e2e/.media/src.webm`).toString('base64');
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, files: true, fps: 30 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('http://localhost:5221/');
  await page.waitForFunction(() => window.turbocutApp);
  const S = (fn, arg) => page.evaluate(fn, arg);
  const files = () => S(() => ({ calls: window.__files.saveAsCalls.length, writes: window.__files.writes.length, paths: Object.keys(window.__files.disk()), dirty: window.turbocutApp.store.dirty, ref: window.turbocutApp.store.fileRef }));

  // ---- work, then the first Save asks where (once)
  await S(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.turbocutApp.importMedia([new File([bytes], 'clip.webm', { type: 'video/webm' })], true);
    window.turbocutApp.store.edit((p) => (p.name = 'My short'));
  }, media);
  let f = await files();
  assert.equal(f.dirty, true);
  assert.equal(f.paths.length, 0, 'nothing is kept anywhere before the person saves');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => !window.turbocutApp.store.dirty);
  f = await files();
  assert.equal(f.calls, 1, 'the first save asks where');
  assert.deepEqual(f.paths, ['/fake/My short.turbocut']);
  assert.deepEqual(f.ref, { kind: 'path', path: '/fake/My short.turbocut' });

  // ---- the next Save writes to the same file without asking
  await S(() => window.turbocutApp.store.edit((p) => (p.name = 'My short')));
  await S(() => window.turbocutApp.actions.addText('Second'));
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => !window.turbocutApp.store.dirty);
  f = await files();
  assert.equal(f.calls, 1, 'saving again does not ask again');
  assert.ok(f.writes >= 1, 'it wrote to the file');
  assert.match(await S(() => window.__files.disk()['/fake/My short.turbocut']), /Second/);

  // ---- autosave follows edits a few seconds later, and Settings can turn it off
  const writes0 = f.writes;
  await S(() => window.turbocutApp.actions.addText('Third'));
  await page.waitForFunction((n) => window.__files.writes.length > n, writes0, { timeout: 8000 });
  assert.equal(await S(() => window.turbocutApp.store.dirty), false, 'autosave clears the unsaved mark');
  assert.match(await S(() => window.__files.disk()['/fake/My short.turbocut']), /Third/);
  await S(() => window.turbocutApp.store.updateSettings({ autosave: false }));
  const writes1 = (await files()).writes;
  await S(() => window.turbocutApp.actions.addText('Fourth'));
  await page.waitForTimeout(4200);
  assert.equal((await files()).writes, writes1, 'with autosave off nothing is written');
  assert.equal(await S(() => window.turbocutApp.store.dirty), true);
  await S(() => window.turbocutApp.store.updateSettings({ autosave: true }));
  await page.waitForFunction(() => !window.turbocutApp.store.dirty, null, { timeout: 8000 });

  // ---- the list on the home screen holds the FILE, never a copy of the edit
  const rows = await S(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('turbocut');
        r.onsuccess = () => {
          const g = r.result.transaction('recent').objectStore('recent').getAll();
          g.onsuccess = () => resolve(g.result);
          g.onerror = () => reject(g.error);
        };
      }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].json, undefined, 'no copy of the project is cached');
  assert.deepEqual(rows[0].ref, { kind: 'path', path: '/fake/My short.turbocut' });

  // ---- a new project is new: unsaved work is asked about, and nothing carries over
  await S(() => window.turbocutApp.actions.addText('Unsaved'));
  assert.equal(await S(() => window.turbocutApp.store.dirty), true);
  await S(() => window.turbocutApp.store.updateSettings({ autosave: false }));
  await S(() => window.turbocutApp.actions.addText('Still unsaved'));
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.locator('.home-recent-open', { hasText: 'My short' }).waitFor();
  assert.match(await page.locator('.home-recent-open', { hasText: 'My short' }).textContent(), /\/fake\/My short\.turbocut/, 'the list says where the file is');
  await page.getByRole('button', { name: /Landscape/ }).click();
  const ask = page.getByRole('dialog', { name: 'Save this project first?' });
  await ask.waitFor();
  await page.keyboard.press('Escape');
  await ask.waitFor({ state: 'detached' }); // Escape is Cancel
  assert.equal(await S(() => window.turbocutApp.store.project.name), 'My short', 'Cancel keeps the project');
  assert.equal(await page.locator('.home').count(), 1, 'and the home screen stays');
  await page.getByRole('button', { name: /Landscape/ }).click();
  await ask.waitFor();
  await page.getByRole('button', { name: 'Discard it' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.home').length === 0);
  const fresh = await S(() => { const p = window.turbocutApp.store.project; return { name: p.name, w: p.width, h: p.height, assets: Object.keys(p.assets).length, clips: p.tracks.flatMap((t) => t.clips).length, ref: window.turbocutApp.store.fileRef, dirty: window.turbocutApp.store.dirty }; });
  assert.deepEqual(fresh, { name: 'Untitled', w: 1920, h: 1080, assets: 0, clips: 0, ref: null, dirty: false }, 'a shape on the home screen starts an empty project of that shape');
  assert.equal((await files()).paths.length, 1, 'discarding wrote nothing anywhere');

  // ---- Save, then continue: cancelling the save dialog keeps everything where it was
  await S(() => window.turbocutApp.actions.addText('Scratch'));
  await S(() => window.turbocutApp.store.edit((p) => (p.name = 'Scratch')));
  await S(() => (window.__files.saveAsPath = () => null)); // the person cancels the save dialog
  await S(() => void window.turbocutApp.actions.newProject());
  await ask.waitFor();
  await page.getByRole('button', { name: 'Save…' }).click();
  await page.waitForTimeout(300);
  assert.equal(await ask.count(), 1, 'a cancelled save does not continue');
  await S(() => (window.__files.saveAsPath = (n) => `/fake/${n}`));
  await page.getByRole('button', { name: 'Save…' }).click();
  await ask.waitFor({ state: 'detached' });
  assert.equal(await S(() => window.turbocutApp.store.project.name), 'Untitled', 'saved, then a new project');
  assert.ok((await files()).paths.includes('/fake/Scratch.turbocut'));

  // ---- a recent project opens from its file; one whose file is gone says so and leaves the list
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.locator('.home-recent-open', { hasText: 'My short' }).click();
  await page.waitForFunction(() => window.turbocutApp.store.project.name === 'My short');
  assert.equal(await S(() => window.turbocutApp.store.project.tracks.flatMap((t) => t.clips).length > 0), true, 'the saved edit came back');
  assert.deepEqual(await S(() => window.turbocutApp.store.fileRef), { kind: 'path', path: '/fake/My short.turbocut' }, 'Save goes back to the same file');
  await page.getByRole('dialog', { name: 'Find the media' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Find the media' }).waitFor({ state: 'detached' });
  await S(() => { const d = window.__files.disk(); delete d['/fake/Scratch.turbocut']; localStorage.setItem('e2e.disk', JSON.stringify(d)); });
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.locator('.home-recent-open', { hasText: 'Scratch' }).click();
  await page.waitForFunction(() => /Could not open Scratch\.turbocut/.test(window.turbocutApp.store.status));
  assert.equal(await page.locator('.home-recent-open', { hasText: 'Scratch' }).count(), 1, 'the home screen is still up');
  await page.getByRole('button', { name: /Remove Scratch from the list/ }).click().catch(() => {});

  // ---- after a reload nothing is left behind but what was saved
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  assert.equal(await S(() => window.turbocutApp.store.project.tracks.flatMap((t) => t.clips).length), 0, 'a reload starts empty: no cached project comes back');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('files e2e passed');
} finally {
  await browser.close();
  await server.close();
}
