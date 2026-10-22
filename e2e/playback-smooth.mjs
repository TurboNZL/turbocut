// Playback smoothness, measured: time from pressing play to the first drawn frame, and the longest wait between two drawn frames,
// when starting cold and when playing across a cut between two clips. The CPU is slowed 4x to stand in for a phone.
// Prints the numbers; asserts only generous limits (a laptop CI runner is not a phone, the point is that a regression shows).
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const server = await createServer({ root, server: { port: 5219, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  // A phone's hardware decoder takes a few hundred milliseconds to open; this sandbox's software decoder opens at once. Every new
  // decoder's first decode waits DECODER_OPEN_MS (default 300), in order, so the cost of opening decoders shows up like on a phone.
  await ctx.addInitScript((ms) => {
    const Orig = window.VideoDecoder;
    window.VideoDecoder = class extends Orig {
      decode(chunk) {
        this._gate ??= new Promise((r) => setTimeout(r, ms));
        this._gate.then(() => super.decode(chunk));
      }
      flush() {
        return this._gate ? this._gate.then(() => super.flush()) : super.flush();
      }
    };
  }, Number(process.env.DECODER_OPEN_MS ?? 300));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5219/');
  await page.waitForFunction(() => window.turbocutApp);
  const cdp = await ctx.newCDPSession(page);
  const importFile = (url, name) => page.evaluate(async ([u, n]) => { const blob = await (await fetch(u)).blob(); await window.turbocutApp.importMedia([new File([blob], n, { type: 'video/webm' })]); }, [url, name]);
  await importFile('/e2e/.media/vonly.webm', 'a.webm');
  await importFile('/e2e/.media/vonly.webm', 'b.webm');
  // a.webm on the timeline, then b.webm right after it: playing across the join is a cut between two clips
  await page.evaluate(() => { const a = window.turbocutApp; const ids = Object.keys(a.store.project.assets); const dur = a.store.project.assets[ids[0]].duration; a.actions.addAsset(ids[1], { at: dur }); });
  const total = await page.evaluate(() => { const a = window.turbocutApp; return Math.max(...a.store.project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration))); });
  const clipEnd = await page.evaluate(() => window.turbocutApp.store.project.tracks.find((t) => t.kind === 'video').clips[0].duration);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const run = async (label, startFrame, ms) => {
    await page.evaluate((f) => { const a = window.turbocutApp; a.store.seek(f); a.__t = []; if (!a.__w) { a.__w = true; a.store.on('playhead', () => a.store.playing && a.__t.push(performance.now())); } }, startFrame);
    await page.waitForTimeout(800); // let the paused frame draw
    const t0 = await page.evaluate(() => { window.turbocutApp.__t = []; const t = performance.now(); void window.turbocutApp.player.play(); return t; });
    await page.waitForTimeout(ms);
    await page.evaluate(() => window.turbocutApp.player.pause());
    const stamps = await page.evaluate(() => window.turbocutApp.__t.slice());
    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
    const m = { label, frames: stamps.length, first: Math.round((stamps[0] ?? Infinity) - t0), maxGap: Math.round(Math.max(0, ...gaps)), gapsOver200: gaps.filter((g) => g > 200).length };
    console.log(JSON.stringify(m));
    return m;
  };
  const cold = await run('cold start inside the first clip', 30, 2500);
  const again = await run('pause then play again', 90, 2500);
  const cut = await run('across the cut', Math.max(0, clipEnd - 30), 2500);
  console.log(JSON.stringify({ clipEnd, total }));
  assert.ok(cold.frames > 5 && again.frames > 5 && cut.frames > 5, 'frames are drawn while playing');
  // Measured before the fix with a 300 ms decoder: 6 frames and 5 stalls over 200 ms in each run. After: about 60 frames, none over 60 ms.
  for (const m of [cold, again, cut]) {
    assert.equal(m.gapsOver200, 0, `${m.label}: no stall over 200 ms (longest ${m.maxGap} ms)`);
    assert.ok(m.frames > 30, `${m.label}: keeps drawing (${m.frames} frames)`);
  }
  assert.deepEqual(errors, []);
  console.log('playback smooth e2e passed');
} finally {
  await browser.close();
  await server.close();
}
