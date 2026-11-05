// The three project file types: .turbocutf (everything inside, the default), .turbocut (the edit only) and .turbocutc (the edit and the clips that
// came from a link); the name of the file beside the File menu; and opening a bundle gives back its videos, fonts and caption style by itself.
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch, serveFakeBundles } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}e2e/.out/`, { recursive: true });
const server = await createServer({ root, server: { port: 5231, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
const media = readFileSync(`${root}e2e/.media/vonly.webm`).toString('base64');
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, files: true, fps: 30 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await serveFakeBundles(page);
  await page.goto('http://localhost:5231/');
  await page.waitForFunction(() => window.turbocutApp);
  const S = (fn, arg) => page.evaluate(fn, arg);
  const label = () => page.locator('.proj-label').textContent();
  const raw = async (path) => {
    const e = await S((p) => window.__files.disk()[p], path);
    return e?.parts ? Buffer.concat(e.parts.map((x) => Buffer.from(x, 'base64'))) : Buffer.from(e ?? '');
  };

  // ---- the file's name sits next to the File menu; an unsaved project says so
  assert.equal(await label(), 'Unsaved project');
  await S(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.turbocutApp.importMedia([new File([bytes], 'clip.webm', { type: 'video/webm' })], true);
    await window.turbocutApp.importMedia([new File([bytes], 'twitch-clip.webm', { type: 'video/webm' })]);
    window.turbocutApp.store.edit((p) => (p.name = 'Bundle test'));
    // the second file came from a link
    const a = Object.values(window.turbocutApp.store.project.assets).find((x) => x.name === 'twitch-clip.webm');
    a.source = { type: 'twitch', url: 'https://clips.twitch.tv/SomeSlug' };
  }, media);
  assert.equal(await label(), 'Unsaved project', 'edits do not make it saved');

  // ---- Save: the full project is what the dialog offers first, and what a plain Save makes
  await S(() => (window.__files.saveAsPath = (n) => `/fake/${n}`));
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => !window.turbocutApp.store.dirty);
  assert.equal(await S(() => window.__files.saveAsCalls.at(-1)), 'Bundle test.turbocutf', 'the dialog starts on the full project');
  assert.equal(await label(), 'Bundle test.turbocutf');
  const full = await raw('/fake/Bundle test.turbocutf');
  assert.equal(full.subarray(0, 18).toString(), 'TURBOCUT-BUNDLE-1\n');
  const text = full.toString('latin1');
  assert.equal((text.match(/"kind":"media"/g) ?? []).length, 2, 'both videos are inside the full project');
  assert.ok(text.includes('"kind":"project"'));
  assert.ok(full.length > 2 * readFileSync(`${root}e2e/.media/vonly.webm`).length, 'it holds the video bytes, not only the edit');
  assert.match(await S(() => window.turbocutApp.store.status), /Saved Bundle test\.turbocutf with 2 media files/);

  // ---- a change shows a dot; a bundle is not rewritten behind the person's back by autosave
  const writes = await S(() => window.__files.writes.length);
  await S(() => window.turbocutApp.actions.addText('Later'));
  assert.equal(await label(), 'Bundle test.turbocutf •', 'a dot says there are changes since the save');
  await page.waitForTimeout(4500);
  assert.equal(await S(() => window.__files.writes.length), writes, 'autosave leaves a full project alone (it would rewrite every video)');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => !window.turbocutApp.store.dirty);
  assert.equal(await S(() => window.__files.saveAsCalls.length), 1, 'Save writes back to the same file without asking');
  assert.equal(await label(), 'Bundle test.turbocutf');

  // ---- Save as the edit only, and with the clips
  await S(() => (window.__files.saveAsPath = () => '/fake/edit.turbocut'));
  await S(() => window.turbocutApp.actions.saveProject(true));
  const edit = await raw('/fake/edit.turbocut');
  assert.equal(edit.subarray(0, 1).toString(), '{', 'a plain project is JSON');
  assert.ok(edit.length < 20000, 'and small');
  assert.equal(await label(), 'edit.turbocut');
  await S(() => (window.__files.saveAsPath = () => '/fake/clips.turbocutc'));
  await S(() => window.turbocutApp.actions.saveProject(true));
  const clips = (await raw('/fake/clips.turbocutc')).toString('latin1');
  assert.equal((clips.match(/"kind":"media"/g) ?? []).length, 1, 'only the clip that came from a link is inside');
  assert.ok(clips.includes('"name":"twitch-clip.webm"') && !clips.includes('"name":"clip.webm"'));
  assert.ok(!clips.includes('"kind":"font"') && !clips.includes('"kind":"preset"'));
  assert.match(await S(() => window.turbocutApp.store.status), /Saved clips\.turbocutc with 1 clip\./);

  // ---- opening a full project gives back its videos with no copy kept anywhere else (the bundle is the only place they are)
  await S(async () => {
    window.turbocutApp.store.updateSettings({ rememberMedia: false });
    await (await navigator.storage.getDirectory()).removeEntry('turbocut-media', { recursive: true }).catch(() => {});
  });
  await S(() => (window.__files.openPath = '/fake/Bundle test.turbocutf'));
  await S(() => void window.turbocutApp.actions.newProject());
  await page.getByRole('button', { name: 'Discard it' }).click().catch(() => {});
  await S(() => void window.turbocutApp.actions.openProject());
  await page.waitForFunction(() => { const st = window.turbocutApp.store; return st.project.name === 'Bundle test' && Object.keys(st.project.assets).length === 2 && /^Opened /.test(st.status); }, null, { timeout: 10000 });
  const back = await S(() => {
    const st = window.turbocutApp.store;
    return { assets: Object.values(st.project.assets).map((a) => [a.name, st.lib.has(a.id)]).sort(), missing: st.missingAssets().length, name: st.fileName, dirty: st.dirty, text: st.project.tracks.flatMap((t) => t.clips).filter((c) => c.text).length };
  });
  assert.deepEqual(back.assets, [['clip.webm', true], ['twitch-clip.webm', true]], 'both videos are open again, read out of the file');
  assert.equal(back.missing, 0);
  assert.equal(back.name, 'Bundle test.turbocutf');
  assert.equal(back.dirty, false);
  assert.equal(await page.getByRole('dialog', { name: 'Find the media' }).count(), 0);
  assert.equal(await label(), 'Bundle test.turbocutf');
  // the picture really decodes from the bundle
  await S(async () => {
    const a = window.turbocutApp;
    const id = Object.keys(a.store.project.assets)[0];
    const pic = await a.store.lib.thumbnail(id);
    if (!pic) throw new Error('no picture from the bundled video');
  });
  // a damaged or foreign file says so and changes nothing
  await S(() => {
    const d = window.__files.disk();
    d['/fake/broken.turbocutf'] = { parts: [btoa('TURBOCUT-BUNDLE-1\n\u0005\u0000\u0000\u0000{"kin')] };
    localStorage.setItem('e2e.disk', JSON.stringify(d));
    window.__files.openPath = '/fake/broken.turbocutf';
  });
  await S(() => window.turbocutApp.actions.openProject());
  assert.match(await S(() => window.turbocutApp.store.status), /Could not open broken\.turbocutf: .*(cut short|damaged)/);
  assert.equal(await S(() => window.turbocutApp.store.project.name), 'Bundle test', 'the open project is untouched');
} catch (e) {
  console.error(e);
  errors.push(String(e));
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error('bundles e2e FAILED:', errors);
  process.exit(1);
}
console.log('bundles e2e passed');
