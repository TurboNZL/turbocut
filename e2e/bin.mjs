// Media bin and multi-track editing in a desktop browser.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5203, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5203/');
  await page.waitForFunction(() => window.turbocutApp);
  const app = (fn, arg) => page.evaluate(fn, arg);
  const tracks = () => app(() => window.turbocutApp.store.project.tracks.map((t) => ({ name: t.name, kind: t.kind, clips: t.clips.map((c) => [c.start, c.duration, c.link ? 1 : 0]), hidden: !!t.hidden, muted: !!t.muted, locked: !!t.locked })));
  const importFile = (url, name) => app(async ([u, n]) => { const blob = await (await fetch(u)).blob(); await window.turbocutApp.importMedia([new File([blob], n, { type: 'video/webm' })]); }, [url, name]);

  // ---- 1. the first import goes on the timeline, later ones wait in the bin
  await importFile('/e2e/.media/src.webm', 'first.webm');
  await importFile('/e2e/.media/src.webm', 'second.webm');
  await importFile('/e2e/.media/vonly.webm', 'picture-only.webm');
  let t = await tracks();
  assert.deepEqual(t.find((x) => x.name === 'V1').clips, [[0, 180, 1]], 'first import placed with its sound, linked');
  assert.equal(await app(() => Object.keys(window.turbocutApp.store.project.assets).length), 3, 'three assets in the bin');

  // ---- 2. the Media tab lists them with thumbnails
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await page.waitForSelector('.bin-item');
  assert.equal(await page.locator('.bin-item').count(), 3);
  await page.waitForFunction(() => document.querySelectorAll('.bin-thumb canvas').length === 3, null, { timeout: 15000 });
  const thumbOk = await page.$$eval('.bin-thumb canvas', (cs) => cs.map((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++; return n / (d.length / 4); }));
  console.log('thumbnail lit fractions:', thumbOk.map((x) => x.toFixed(2)).join(' '));
  assert.ok(thumbOk.every((x) => x > 0.3), 'every thumbnail shows a picture');
  await page.screenshot({ path: `${out}bin.png` });

  // ---- 3. Add puts it at the playhead, moved past what is already there
  await page.locator('.bin-item', { hasText: 'second.webm' }).getByRole('button', { name: 'Add' }).click();
  t = await tracks();
  console.log('after Add:', JSON.stringify({ V1: t.find((x) => x.name === 'V1').clips, A1: t.find((x) => x.name === 'A1').clips }));
  assert.deepEqual(t.find((x) => x.name === 'V1').clips[1], [180, 180, 1], 'starts right after the first clip');
  assert.deepEqual(t.find((x) => x.name === 'A1').clips[1], [180, 180, 1], 'and its sound lines up on A1');
  assert.equal(await page.locator('.bin-item', { hasText: 'second.webm' }).locator('.bin-meta').textContent().then((x) => /used 1/.test(x)), true, 'the bin shows it is used');

  // ---- 4. a second video track, then drag the picture-only clip onto it with the mouse
  await page.getByRole('button', { name: '+ Track' }).click();
  await page.getByRole('menuitem', { name: 'Add a video track' }).click();
  t = await tracks();
  assert.deepEqual(t.filter((x) => x.kind === 'video').map((x) => x.name), ['V1', 'V2']);
  assert.ok(await page.locator('.tl-track.active', { hasText: 'V2' }).count(), 'the new track is the active one');
  const thumb = await page.locator('.bin-item', { hasText: 'picture-only' }).locator('.bin-thumb').boundingBox();
  const v2 = await page.locator('.tl-track[data-track]', { hasText: 'V2' }).boundingBox();
  const dropX = v2.x + 56 + 100 * 3; // frame 100 at zoom 3
  await page.mouse.move(thumb.x + 20, thumb.y + 20);
  await page.mouse.down();
  await page.mouse.move(thumb.x + 60, thumb.y + 30, { steps: 5 });
  await page.mouse.move(dropX, v2.y + v2.height / 2, { steps: 12 });
  assert.ok(await page.locator('.tl-track.drop-target').count(), 'the track under the pointer is highlighted while dragging');
  await page.mouse.up();
  t = await tracks();
  console.log('V2 after drop:', JSON.stringify(t.find((x) => x.name === 'V2').clips));
  assert.deepEqual(t.find((x) => x.name === 'V2').clips, [[100, 120, 0]], 'dropped exactly at frame 100 on V2, no sound, not linked');

  // ---- 5. two tracks composite: V2 small in a corner on top of V1; hiding V2 changes the picture
  await app(() => {
    const s = window.turbocutApp.store; const c = s.project.tracks.find((x) => x.name === 'V2').clips[0];
    s.edit(() => { c.base = { scale: 0.35, x: -300, y: -500 }; });
    s.seek(120);
  });
  const frameSig = async () => { await page.waitForTimeout(700); return app(() => { const cv = window.turbocutApp.player.canvas; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let sum = 0; for (let i = 0; i < d.length; i += 40) sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return sum; }); };
  const withV2 = await frameSig();
  await page.locator('.tl-head', { hasText: 'V2' }).click();
  await page.getByRole('menuitem', { name: 'Hide this track' }).click();
  const hidden = await frameSig();
  await page.locator('.tl-head', { hasText: 'V2' }).click();
  await page.getByRole('menuitem', { name: 'Show this track' }).click();
  const shown = await frameSig();
  console.log('picture signature visible/hidden/visible:', withV2, hidden, shown);
  assert.notEqual(withV2, hidden, 'hiding the track changes what is drawn');
  assert.equal(withV2, shown, 'showing it brings the same picture back');
  await page.screenshot({ path: `${out}multitrack.png` });

  // ---- 6. a muted audio track is silent in the export
  const exportLevel = async (label) => {
    const r = await app(() => window.turbocutApp.exportForTest());
    const file = `${out}bin-${label}.${r.container}`;
    writeFileSync(file, Buffer.from(r.b64, 'base64'));
    const log = execFileSync('sh', ['-c', `ffmpeg -i '${file}' -vn -af volumedetect -f null - 2>&1`], { encoding: 'utf8' });
    return Number(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1] ?? -999);
  };
  const loud = await exportLevel('loud');
  await page.locator('.tl-head', { hasText: 'A1' }).click();
  await page.getByRole('menuitem', { name: 'Mute this track' }).click();
  const quiet = await exportLevel('muted');
  console.log(`export peak with A1 audible ${loud} dB, muted ${quiet} dB`);
  assert.ok(loud > -30, 'the audio is there when the track is not muted');
  assert.ok(quiet < -60, 'a muted audio track is silent in the export');
  await page.locator('.tl-head', { hasText: 'A1' }).click();
  await page.getByRole('menuitem', { name: 'Unmute this track' }).click();

  // ---- 7. a locked track cannot be edited
  const v1Clip = await app(() => window.turbocutApp.store.project.tracks.find((x) => x.name === 'V1').clips[0].id);
  await page.locator('.tl-head', { hasText: 'V1' }).click();
  await page.getByRole('menuitem', { name: 'Lock this track' }).click();
  await app((id) => { window.turbocutApp.store.select(id); window.turbocutApp.store.seek(60); }, v1Clip);
  const before = JSON.stringify((await tracks()).find((x) => x.name === 'V1').clips);
  await page.keyboard.press('s');
  await page.keyboard.press('Delete');
  assert.equal(JSON.stringify((await tracks()).find((x) => x.name === 'V1').clips), before, 'split and delete do nothing on a locked track');
  const box = await page.locator('.tl-track.locked .tl-clip').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
  assert.equal(JSON.stringify((await tracks()).find((x) => x.name === 'V1').clips), before, 'dragging does nothing either');
  await page.locator('.tl-head', { hasText: 'V1' }).click();
  await page.getByRole('menuitem', { name: 'Unlock this track' }).click();

  // ---- 8. waveforms: on by default on desktop, gone when switched off
  await page.waitForFunction(() => [...document.querySelectorAll('.tl-wave')].some((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true; return false; }), null, { timeout: 15000 });
  console.log('waveform canvases:', await page.locator('.tl-wave').count());
  await app(() => window.turbocutApp.store.updateSettings({ waveforms: false }));
  assert.equal(await page.locator('.tl-wave').count(), 0, 'no waveforms when the setting is off');
  await app(() => window.turbocutApp.store.updateSettings({ waveforms: true }));

  // ---- 9. only an empty, spare track can be deleted
  await page.locator('.tl-head', { hasText: 'V1' }).click();
  assert.ok(await page.getByRole('menuitem', { name: 'Delete this track' }).isDisabled(), 'V1 has clips');
  await page.keyboard.press('Escape');
  await app(() => { const s = window.turbocutApp.store; s.select(s.project.tracks.find((x) => x.name === 'V2').clips[0].id); });
  await page.keyboard.press('Delete');
  await page.locator('.tl-head', { hasText: 'V2' }).click();
  await page.getByRole('menuitem', { name: 'Delete this track' }).click();
  assert.deepEqual((await tracks()).filter((x) => x.kind === 'video').map((x) => x.name), ['V1'], 'the empty spare track is gone');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('bin e2e passed');
} finally {
  await browser.close();
  await server.close();
}
