// Memory and speed of the real app in Electron: import a 90 s 1080p H.264 file through the real file picker,
// play it, export it, and sample every process's memory along the way.
import { writeFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const file = `${root}e2e/.media/big.mp4`;
const app = await electron.launch({ args: ['--no-sandbox', root], cwd: root });
const win = await app.firstWindow();
await win.waitForFunction(() => window.turbocutApp, null, { timeout: 30000 });
const mb = (kb) => Math.round(kb / 1024);
const sample = async (label) => {
  const m = await app.evaluate(({ app: a }) => a.getAppMetrics().map((p) => ({ type: p.type, name: p.name ?? '', ws: p.memory.workingSetSize, priv: p.memory.privateBytes ?? 0 })));
  const total = m.reduce((n, p) => n + p.ws, 0);
  const byType = m.map((p) => `${p.type}${p.name ? ':' + p.name : ''}=${mb(p.ws)}`).join(' ');
  const heap = await win.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));
  console.log(`${label.padEnd(26)} total ${String(mb(total)).padStart(5)} MB | js heap ${heap} MB | ${byType}`);
  return { total: mb(total), m };
};
const results = {};
results.start = await sample('start');
const [chooser] = await Promise.all([win.waitForEvent('filechooser'), win.getByRole('button', { name: 'Import' }).click()]);
await chooser.setFiles(file);
await win.waitForFunction(() => window.turbocutApp.store.project.tracks[0].clips.length > 0, null, { timeout: 60000 });
await win.waitForTimeout(1500);
results.imported = await sample('after import');
// Attribute the memory: audio path alone, then video path alone, then the real player.
await win.evaluate(() => window.turbocutApp.probeAudio(60));
results.audioOnly = await sample('audio path only (60 s)');
await win.evaluate(() => window.turbocutApp.probeDecode('samples', 150));
results.decodeOnly = await sample('raw decode, frames closed');
await win.evaluate(() => window.turbocutApp.probeDecode('bitmap960', 150));
results.bmp960 = await sample('decode + bitmap 960 + draw');
await win.evaluate(() => window.turbocutApp.probeDecode('bitmap1920', 150));
results.bmp1920 = await sample('decode + bitmap 1920 + draw');
await win.evaluate(() => window.turbocutApp.probeDecode('draw', 150));
results.drawn = await sample('decode + draw full frame');
await win.evaluate(() => window.turbocutApp.probeVideo(150));
results.videoOnly = await sample('my full video path');
await win.evaluate(() => window.turbocutApp.store.seek(0));
await win.evaluate(() => window.turbocutApp.player.play());
for (const t of [3, 6, 10]) { await win.waitForTimeout(t === 3 ? 3000 : t === 6 ? 3000 : 4000); results['play' + t] = await sample(`playing ${t} s`); }
const frame = await win.evaluate(() => window.turbocutApp.store.playhead);
console.log('playhead after ~10 s of playback:', frame, '(60 fps => about 600)');
await win.evaluate(() => window.turbocutApp.player.pause());
await win.waitForTimeout(500);
results.paused = await sample('paused');
const t0 = Date.now();
const info = await win.evaluate(() => window.turbocutApp.exportForTest());
console.log(`export: ${info.frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s = ${(info.frames / ((Date.now() - t0) / 1000)).toFixed(1)} fps, ${info.videoCodec}/${info.audioCodec}, ${(info.bytes / 1e6).toFixed(1)} MB`);
results.exported = await sample('after export');
await win.evaluate(() => { if (window.gc) window.gc(); });
await win.waitForTimeout(1500);
results.settled = await sample('settled after export');
writeFileSync(`${root}e2e/.out/memory.json`, JSON.stringify(results, null, 1));
await app.close();
