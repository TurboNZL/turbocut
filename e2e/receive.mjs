// Receive from a computer: a "shelf" put up by the desktop shell's sharing code (the real electron/share.cjs, run here in Node) is fetched by the
// page with an address and a code, the way a phone does it. The Twitch clip travels as a link inside the project and is downloaded by the
// receiving page (Twitch itself is answered by the test). Also: a wrong code says so, and the home screen offers the window.
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const require = createRequire(import.meta.url);
const { Share } = require('../electron/share.cjs');
const root = new URL('..', import.meta.url).pathname;
const server = await createServer({ root, server: { port: 5211, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
const pc = new Share({ dir: mkdtempSync(join(tmpdir(), 'tcrecv-')), name: 'Studio PC', version: '1', port: 0 });
pc.startDiscovery = async () => {};
await pc.start();
try {
  const src = readFileSync(`${root}e2e/.media/src.webm`);
  const vonly = readFileSync(`${root}e2e/.media/vonly.webm`);
  const newPage = async (opts = {}) => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:5211/');
    await page.waitForFunction(() => window.turbocutApp);
    return page;
  };

  // ---- the sending side's project: one local file, one Twitch clip (kept as a link, its file left out)
  const a = await newPage();
  const projectText = await a.evaluate(async ([b64, b64b]) => {
    const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const app = window.turbocutApp;
    await app.importMedia([new File([bytes(b64)], 'clip.webm', { type: 'video/webm' })]);
    const failed = await app.actions.importOne(new File([bytes(b64b)], 'Twitch moment.mp4', { type: 'video/webm' }), false, undefined, { type: 'twitch', url: 'https://clips.twitch.tv/FunnyTestSlug' });
    if (failed) throw new Error(failed);
    for (const id of Object.keys(app.store.project.assets)) app.actions.addAsset(id);
    app.store.edit((p) => (p.name = 'From the PC'));
    return (await import('/src/core/projectFile.ts')).serializeProject(app.store.project);
  }, [src.toString('base64'), vonly.toString('base64')]);
  const project = JSON.parse(projectText).project;
  assert.deepEqual(Object.values(project.assets).map((x) => x.source?.url ?? null).sort(), ['https://clips.twitch.tv/FunnyTestSlug', null], 'the Twitch link is in the saved project');

  const { id } = pc.shelfOpen({ project: 'From the PC', media: 1, fonts: 0, links: 1, bytes: 0 });
  for (const [kind, name, data] of [['project', 'project.turbocut', Buffer.from(projectText)], ['media', 'clip.webm', src]]) {
    const w = pc.shelfPart(id, kind, name);
    await w.write(data);
    await w.end();
  }
  const info = pc.shelfReady(id);

  // ---- the receiving side: a fresh page. Twitch is answered by the test (the clip is the second test video).
  const b = await newPage({ home: true });
  await b.route('https://gql.twitch.tv/gql', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ data: { clip: { title: 'Twitch moment', durationSeconds: 4, playbackAccessToken: { signature: 's', value: 'v' }, assets: [{ aspectRatio: 1.77, videoQualities: [{ quality: '360', frameRate: 30, sourceURL: 'https://clips-media-assets2.twitch.tv/test.mp4' }] }] } } }]) }));
  await b.route('https://clips-media-assets2.twitch.tv/**', (r) => r.fulfill({ status: 200, contentType: 'video/mp4', headers: { 'access-control-allow-origin': '*', 'content-length': String(vonly.length) }, body: vonly }));
  await b.locator('.home-quick', { hasText: 'From a computer' }).click();
  const dlg = b.getByRole('dialog', { name: 'Receive from a computer' });
  await dlg.waitFor();

  // a wrong code is explained and the window stays
  const wrong = info.code === '123456' ? '654321' : '123456';
  await dlg.getByLabel('Address of the computer').fill(`127.0.0.1:${info.port}`);
  await dlg.getByLabel('Code').fill(wrong);
  await dlg.getByRole('button', { name: 'Receive' }).click();
  await dlg.getByText(/code is not right/).waitFor();

  // the right code brings everything, and the link is downloaded without anyone picking a file
  await dlg.getByLabel('Code').fill(info.code);
  assert.match(await dlg.getByLabel('Code').inputValue(), /^\d{3} \d{3}$/, 'the code is shown in two halves');
  await dlg.getByRole('button', { name: 'Receive' }).click();
  await b.waitForFunction(() => window.turbocutApp.store.project.name === 'From the PC', null, { timeout: 20000 });
  await b.waitForFunction(() => window.turbocutApp.store.missingAssets().length === 0, null, { timeout: 30000 });
  const got = await b.evaluate(() => Object.values(window.turbocutApp.store.project.assets).map((x) => [x.name, !!x.source]).sort());
  assert.deepEqual(got, [['Twitch moment.mp4', true], ['clip.webm', false]]);
  assert.equal(pc.shelves.size, 0, 'the computer closed the shelf when the page had everything');
  assert.equal(await b.getByRole('dialog', { name: 'Find the media' }).count(), 0, 'nothing is left to find');
  assert.equal(await b.evaluate(() => localStorage.getItem('turbocut.lastSender')), `127.0.0.1:${info.port}`, 'the address is remembered');

  // ---- the same link, when Twitch cannot be reached: the project still opens and asks for the file
  const c = await newPage();
  await c.route('https://gql.twitch.tv/gql', (r) => r.abort());
  const sh = pc.shelfOpen({ project: 'From the PC', media: 0, fonts: 0, links: 1, bytes: 0 });
  const w = pc.shelfPart(sh.id, 'project', 'project.turbocut');
  await w.write(Buffer.from(projectText));
  await w.end();
  const info2 = pc.shelfReady(sh.id);
  await c.evaluate(([addr, code]) => import('/src/app/receive.ts').then((m) => m.openReceiveDialog(window.turbocutApp.store, window.turbocutApp.actions)), ['x', 'y']);
  const d2 = c.getByRole('dialog', { name: 'Receive from a computer' });
  await d2.getByLabel('Address of the computer').fill(`127.0.0.1:${info2.port}`);
  await d2.getByLabel('Code').fill(info2.code);
  await d2.getByRole('button', { name: 'Receive' }).click();
  await c.getByRole('dialog', { name: /Downloading/ }).getByText(/Could not reach Twitch/).waitFor({ timeout: 20000 });
  await c.getByRole('dialog', { name: /Downloading/ }).locator('.bt-footer').getByRole('button', { name: 'Close' }).click();
  await c.getByRole('dialog', { name: 'Find the media' }).waitFor();
  assert.match(await c.getByRole('dialog', { name: 'Find the media' }).textContent(), /clip\.webm/);
  assert.match(await c.getByRole('dialog', { name: 'Find the media' }).textContent(), /Twitch moment\.mp4/);

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log('receive ok');
} finally {
  pc.stop();
  await browser.close();
  await server.close();
}
