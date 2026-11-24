// Receive from a computer: a "shelf" put up by the desktop shell's sharing code (the real electron/share.cjs, run here in Node) is fetched by the
// page from the link the computer shows (pasted into one box), the way a phone does it. The Twitch clip travels as a link inside the project and is downloaded by the
// receiving page (Twitch itself is answered by the test). Also: a used or wrong link says so, and the home screen offers the window.
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
  await b.locator('.home-quick', { hasText: 'Send or receive' }).click();
  const dlg = b.getByRole('dialog', { name: 'Receive from a computer' });
  await dlg.waitFor();

  // something that is not a link is explained and the window stays; so is a link that is wrong
  const box = dlg.getByLabel('Link from the computer');
  await box.fill('192.168.1.20');
  await dlg.getByRole('button', { name: 'Receive' }).click();
  await dlg.getByText(/not a TurboCut link/).waitFor();
  const wrong = info.token.replace(/^./, info.token[0] === 'a' ? 'b' : 'a');
  await box.fill(`http://127.0.0.1:${info.port}/shelf/${wrong}`);
  await dlg.getByRole('button', { name: 'Receive' }).click();
  await dlg.getByText(/already been used or has closed/).waitFor();

  // the right link brings everything, and the Twitch link is downloaded without anyone picking a file (the text around it does not matter)
  await box.fill(`Here: http://127.0.0.1:${info.port}/shelf/${info.token} thanks`);
  await dlg.getByRole('button', { name: 'Receive' }).click();
  await b.waitForFunction(() => window.turbocutApp.store.project.name === 'From the PC', null, { timeout: 20000 });
  await b.waitForFunction(() => window.turbocutApp.store.missingAssets().length === 0, null, { timeout: 30000 });
  const got = await b.evaluate(() => Object.values(window.turbocutApp.store.project.assets).map((x) => [x.name, !!x.source]).sort());
  assert.deepEqual(got, [['Twitch moment.mp4', true], ['clip.webm', false]]);
  assert.equal(pc.shelves.size, 0, 'the computer closed the shelf when the page had everything');
  assert.equal(await b.getByRole('dialog', { name: 'Find the media' }).count(), 0, 'nothing is left to find');

  // ---- after that first transfer the computer is remembered on both sides: the second time needs no link
  const remembered = await b.evaluate(() => JSON.parse(localStorage.getItem('turbocut.pairing')));
  assert.equal(remembered.computers.length, 1);
  assert.equal(remembered.computers[0].name, 'Studio PC');
  assert.equal(remembered.computers[0].base, `http://127.0.0.1:${info.port}`);
  assert.equal(pc.pairedList().length, 1, 'the computer remembers the phone');
  assert.equal(pc.pairedList()[0].name, 'TurboCut device');
  const second = JSON.parse(projectText);
  second.project.name = 'Second one';
  second.project.assets = {};
  second.project.tracks.forEach((t) => (t.clips = []));
  const again = pc.shelfOpen({ project: 'Second one', media: 0, fonts: 0, links: 0, bytes: 0 }, pc.pairedList()[0].id);
  const w2 = pc.shelfPart(again.id, 'project', 'project.turbocut');
  await w2.write(Buffer.from(JSON.stringify(second)));
  await w2.end();
  pc.shelfReady(again.id);
  await b.evaluate(() => import('/src/app/receive.ts').then((m) => m.openReceiveDialog(window.turbocutApp.store, window.turbocutApp.actions)));
  const d3 = b.getByRole('dialog', { name: 'Receive from a computer' });
  await d3.getByText('Studio PC').waitFor();
  await b.getByRole('dialog', { name: 'Save this project first?' }).getByRole('button', { name: 'Discard it' }).click({ timeout: 20000 });
  await b.waitForFunction(() => window.turbocutApp.store.project.name === 'Second one', null, { timeout: 20000 });
  assert.equal(pc.shelves.size, 0, 'it arrived without anyone pasting a link, and the shelf closed');
  // a device the computer does not know sees nothing of it
  const stranger = await newPage();
  const other = pc.shelfOpen({ project: 'Private', media: 0, fonts: 0, links: 0, bytes: 0 }, pc.pairedList()[0].id);
  const w3 = pc.shelfPart(other.id, 'project', 'project.turbocut');
  await w3.write(Buffer.from(JSON.stringify(second)));
  await w3.end();
  pc.shelfReady(other.id);
  const seen = await stranger.evaluate(async (port) => (await fetch(`http://127.0.0.1:${port}/inbox`, { headers: { 'X-Turbocut-Key': 'Z'.repeat(22) } })).json(), info.port);
  assert.deepEqual(seen, { none: true });
  pc.shelfClose(other.id);
  await stranger.close();

  // ---- the same link, when Twitch cannot be reached: the project still opens and asks for the file
  const c = await newPage();
  await c.route('https://gql.twitch.tv/gql', (r) => r.abort());
  const sh = pc.shelfOpen({ project: 'From the PC', media: 0, fonts: 0, links: 1, bytes: 0 });
  const w = pc.shelfPart(sh.id, 'project', 'project.turbocut');
  await w.write(Buffer.from(projectText));
  await w.end();
  const info2 = pc.shelfReady(sh.id);
  await c.evaluate(() => import('/src/app/receive.ts').then((m) => m.openReceiveDialog(window.turbocutApp.store, window.turbocutApp.actions)));
  const d2 = c.getByRole('dialog', { name: 'Receive from a computer' });
  await d2.getByLabel('Link from the computer').fill(`http://127.0.0.1:${info2.port}/shelf/${info2.token}`);
  await d2.getByRole('button', { name: 'Receive' }).click();
  await c.getByRole('dialog', { name: /Downloading/ }).getByText(/Could not reach Twitch/).waitFor({ timeout: 20000 });
  await c.getByRole('dialog', { name: /Downloading/ }).locator('.bt-footer').getByRole('button', { name: 'Close' }).click();
  await c.getByRole('dialog', { name: 'Find the media' }).waitFor();
  assert.match(await c.getByRole('dialog', { name: 'Find the media' }).textContent(), /clip\.webm/);
  assert.match(await c.getByRole('dialog', { name: 'Find the media' }).textContent(), /Twitch moment\.mp4/);

  // ---- a computer now sends ONE project file (.turbocutf): the phone keeps it in Projects, opens it from there, and the project manager lists it
  const bundleB64 = await a.evaluate(async () => {
    const app = window.turbocutApp;
    const { packBundle } = await import('/src/core/bundle.ts');
    const { serializeProject, projectFileName } = await import('/src/core/projectFile.ts');
    const media = Object.values(app.store.project.assets).map((x) => ({ name: x.name, blob: app.store.lib.fileFor(x.id) })).filter((m) => m.blob && m.name === 'clip.webm');
    const blob = packBundle([{ kind: 'project', name: 'project.turbocut', blob: new Blob([serializeProject(app.store.project)]) }, ...media.map((m) => ({ kind: 'media', name: m.name, blob: m.blob }))]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin), name: projectFileName(app.store.project.name, 'full') };
  });
  assert.equal(bundleB64.name, 'From the PC.turbocutf');
  const sh2 = pc.shelfOpen({ project: 'From the PC', media: 1, fonts: 0, links: 0, bytes: 0 });
  const wb = pc.shelfPart(sh2.id, 'bundle', bundleB64.name);
  await wb.write(Buffer.from(bundleB64.b64, 'base64'));
  await wb.end();
  const info3 = pc.shelfReady(sh2.id);
  const d = await newPage({ home: true });
  await d.locator('.home-quick', { hasText: 'Send or receive' }).click();
  const dd = d.getByRole('dialog', { name: 'Receive from a computer' });
  await dd.getByLabel('Link from the computer').fill(`http://127.0.0.1:${info3.port}/shelf/${info3.token}`);
  await dd.getByRole('button', { name: 'Receive' }).click();
  await d.waitForFunction(() => window.turbocutApp.store.project.name === 'From the PC', null, { timeout: 20000 });
  const kept = await d.evaluate(() => ({ ref: window.turbocutApp.store.fileRef?.kind, file: window.turbocutApp.store.fileName, missing: window.turbocutApp.store.missingAssets().length }));
  assert.deepEqual(kept, { ref: 'handle', file: 'From the PC.turbocutf', missing: 1 }, 'kept as a project file in Projects; the clip came inside it, the Twitch clip is still to download');
  assert.equal(pc.shelves.size, 0, 'the shelf closed');
  // ... and the project manager lists it
  await d.getByRole('dialog', { name: 'Find the media' }).waitFor({ timeout: 5000 }).then(() => d.keyboard.press('Escape'), () => {});
  await d.evaluate(() => import('/src/app/projectManager.ts').then((m) => m.openProjectManager(window.turbocutApp.store, window.turbocutApp.actions)));
  const pm = d.getByRole('dialog', { name: 'Projects' });
  await pm.locator('.pm-row').first().waitFor();
  assert.deepEqual(await pm.locator('.pm-row').evaluateAll((els) => els.map((e) => e.dataset.name)), ['From the PC.turbocutf']);
  assert.match(await pm.locator('.pm-row').first().textContent(), /Full project/);
  assert.match(await pm.locator('.pm-folders').textContent(), /private storage/);
  // rename (the open project follows its file), then delete with the confirmation
  await pm.getByRole('button', { name: 'Rename From the PC.turbocutf' }).click();
  const ask = d.getByRole('dialog', { name: 'Rename project' });
  await ask.locator('input').fill('Renamed on the phone');
  await ask.getByRole('button', { name: 'Rename' }).click();
  await pm.locator('.pm-row[data-name="Renamed on the phone.turbocutf"]').waitFor();
  assert.equal(await d.evaluate(() => window.turbocutApp.store.fileName), 'Renamed on the phone.turbocutf', 'the open project follows its renamed file');
  await pm.getByRole('button', { name: 'Delete Renamed on the phone.turbocutf' }).click();
  await d.getByRole('dialog', { name: 'Delete this project?' }).getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await pm.locator('.pm-row').count(), 1, 'cancelling keeps it');
  await pm.getByRole('button', { name: 'Delete Renamed on the phone.turbocutf' }).click();
  await d.getByRole('dialog', { name: 'Delete this project?' }).getByRole('button', { name: 'Delete' }).click();
  await pm.locator('.pm-empty').waitFor();

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log('receive ok');
} finally {
  pc.stop();
  await browser.close();
  await server.close();
}
