// Real touch input (Chrome DevTools Protocol touch events) against the phone layout: pan, tap, trim handles, move, buttons.
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5194, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, fps: 30 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await page.goto('http://localhost:5194/');
  await page.waitForFunction(() => window.turbocutApp);
  await page.evaluate(async () => {
    const blob = await (await fetch('/e2e/.media/src.webm')).blob();
    await window.turbocutApp.importMedia([new File([blob], 'clip.webm', { type: 'video/webm' })]);
    window.turbocutApp.store.seek(0);
  });
  await page.waitForTimeout(500);

  const state = () => page.evaluate(() => {
    const a = window.turbocutApp; const p = a.store.project;
    const sc = document.querySelector('.tl-scroll');
    return { clips: p.tracks[0].clips.map((c) => [c.start, c.duration]), sel: a.store.selected, playhead: a.store.playhead, zoom: a.store.zoom, scrollLeft: sc.scrollLeft, handles: document.querySelectorAll('.tl-handle').length, touch: document.querySelector('.tl').classList.contains('touch') };
  });
  const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  // One finger down at (x, y), moved by dx in small paced steps like a real finger, then lifted.
  const drag = async (x, y, dx, steps = 10) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / steps, y }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
  };

  let st = await state();
  assert.equal(st.touch, true, 'phone layout uses touch mode');
  assert.equal(st.playhead, 0);
  const clip0 = await rect('.tl-track.tl-video .tl-clip');
  console.log('clip box', JSON.stringify(clip0), 'zoom', st.zoom);

  // 1. Pan with one finger starting ON an unselected clip: the timeline must scroll and the playhead follow; the clip must not move.
  await drag(300, clip0.y + clip0.h / 2, -150); // finger moves left: the timeline follows it. x=300 is on the clip, inside the screen
  await page.waitForTimeout(500);
  st = await state();
  console.log('after pan:', JSON.stringify(st));
  assert.deepEqual(st.clips, [[0, 180]], 'panning over an unselected clip must not move or trim it');
  assert.ok(st.playhead > 40 && st.playhead < 80, `150 px at zoom 3 is about 50 frames (a little more with momentum), got ${st.playhead}`);
  assert.ok(Math.abs(st.scrollLeft - st.playhead * st.zoom) < 4, 'playhead stays under the middle marker');
  assert.equal(st.sel, null, 'a swipe does not select');

  // 2. Tap selects and shows the two big handles.
  await page.touchscreen.tap(clip0.x + 60, clip0.y + clip0.h / 2);
  await page.waitForTimeout(200);
  st = await state();
  assert.ok(st.sel, 'tap selects the clip');
  assert.equal(st.handles, 2, 'selected clip shows two trim handles');
  await page.screenshot({ path: `${out}touch-selected.png` });

  // Scroll the clip's end into view first, as a person would (the clip is wider than the screen).
  await page.evaluate(() => window.turbocutApp.store.seek(170));
  await page.waitForTimeout(300);

  // 3. Drag the right handle with a finger: trims the end, preview follows the edge, the edge ends up under the playhead.
  const right = await rect('.tl-handle.right');
  const before = (await state()).clips[0];
  await drag(right.x + right.w / 2, right.y + right.h / 2, -60);
  st = await state();
  console.log('after right-handle drag -60px:', JSON.stringify(st.clips), 'playhead', st.playhead);
  assert.ok(before[1] - st.clips[0][1] >= 15 && before[1] - st.clips[0][1] <= 25, `-60 px at zoom 3 is ~20 frames, trimmed ${before[1] - st.clips[0][1]}`);
  assert.equal(st.playhead, st.clips[0][0] + st.clips[0][1] - 1, 'preview sits on the new last frame');
  assert.ok(Math.abs(st.scrollLeft - st.playhead * st.zoom) < 4, 'edge re-centred under the playhead after release');

  // 4. Drag the left handle: trims the start. Bring the start into view first.
  await page.evaluate((f) => window.turbocutApp.store.seek(f), (await state()).clips[0][0] + 5);
  await page.waitForTimeout(300);
  const left = await rect('.tl-handle.left');
  const b2 = (await state()).clips[0];
  await drag(left.x + left.w / 2, left.y + left.h / 2, 45);
  st = await state();
  console.log('after left-handle drag +45px:', JSON.stringify(st.clips));
  assert.ok(st.clips[0][0] - b2[0] >= 10 && st.clips[0][0] - b2[0] <= 20, `+45 px is ~15 frames, start moved ${st.clips[0][0] - b2[0]}`);

  // 5. Trim buttons: scrub with a swipe, then Trim end cuts to the playhead.
  await page.evaluate(() => window.turbocutApp.store.seek(70));
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Trim end' }).tap();
  st = await state();
  console.log('after Trim end at 70:', JSON.stringify(st.clips));
  assert.equal(st.clips[0][0] + st.clips[0][1], 70, 'Trim end cuts at the playhead');

  // 6. Split button splits at the playhead; then drag the selected clip body to move it.
  await page.evaluate(() => window.turbocutApp.store.seek(50));
  await page.evaluate(() => window.turbocutApp.store.select(null));
  await page.getByRole('button', { name: 'Split' }).tap();
  st = await state();
  assert.equal(st.clips.length, 2, 'Split splits all clips under the playhead');
  const second = await page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips[1].id);
  await page.evaluate((id) => window.turbocutApp.store.select(id), second);
  await page.waitForTimeout(200);
  const body = await page.evaluate(() => { const r = document.querySelector('.tl-track.tl-video .tl-clip.sel').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const before3 = (await state()).clips[1][0];
  await drag(body.x + body.w / 2, body.y + body.h / 2, 60);
  st = await state();
  console.log('after moving selected clip +60px:', JSON.stringify(st.clips));
  assert.ok(st.clips[1][0] - before3 >= 10, 'dragging the selected clip body moves it');

  // 7. Pinch to zoom with two real fingers: spread zooms in, pinch zooms out, and the frame in the middle stays put.
  await page.evaluate(() => window.turbocutApp.store.setZoom(3));
  await page.evaluate(() => window.turbocutApp.store.seek(40));
  await page.waitForTimeout(300);
  const y = (await rect('.tl-track.tl-video')).y + 20;
  const two = async (a0, b0, a1, b1, steps = 8) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a0, y, id: 1 }, { x: b0, y, id: 2 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a0 + ((a1 - a0) * i) / steps, y, id: 1 }, { x: b0 + ((b1 - b0) * i) / steps, y, id: 2 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
  };
  const z0 = (await state()).zoom, f0 = (await state()).playhead;
  await two(170, 220, 100, 290); // fingers 50 px apart -> 190 px apart: about 3.8x
  let st2 = await state();
  console.log(`pinch out (spread): zoom ${z0} -> ${st2.zoom.toFixed(2)}, playhead ${f0} -> ${st2.playhead}`);
  assert.ok(st2.zoom > z0 * 2, 'spreading two fingers zooms in');
  assert.ok(Math.abs(st2.playhead - f0) <= 2, 'the frame under the middle marker stays put while zooming');
  assert.ok(Math.abs(st2.scrollLeft - st2.playhead * st2.zoom) < 4, 'and stays centred');
  const z1 = st2.zoom;
  await two(100, 290, 170, 220); // back together
  st2 = await state();
  console.log(`pinch in: zoom ${z1.toFixed(2)} -> ${st2.zoom.toFixed(2)}, playhead ${st2.playhead}`);
  assert.ok(st2.zoom < z1 / 2, 'pinching two fingers together zooms out');
  assert.ok(Math.abs(st2.playhead - f0) <= 2, 'playhead still where it was');
  assert.deepEqual((await state()).clips, st.clips ?? (await state()).clips, 'zooming does not touch the clips');

  // 8. Media bin and track chips by touch
  await page.evaluate(async () => {
    const blob = await (await fetch('/e2e/.media/vonly.webm')).blob();
    await window.turbocutApp.importMedia([new File([blob], 'extra.webm', { type: 'video/webm' })]);
  });
  await page.getByRole('tab', { name: 'Media', exact: true }).tap();
  await page.waitForSelector('.bin-item');
  const clipsBefore = (await state()).clips.length;
  await page.locator('.bin-item', { hasText: 'extra.webm' }).getByRole('button', { name: 'Add' }).tap();
  const afterAdd = await page.evaluate(() => window.turbocutApp.store.project.tracks.flatMap((t) => t.clips.map((c) => [t.name, c.start, c.duration])).filter((x) => x[2] === 120));
  console.log('after tapping Add:', JSON.stringify(afterAdd));
  assert.ok(afterAdd.length === 1, 'tapping Add puts the clip on the timeline');
  await page.screenshot({ path: `${out}touch-bin.png` });
  await page.getByRole('tab', { name: 'Media', exact: true }).tap(); // tap the open tab again: the sheet closes
  await page.locator('.tl-head').first().tap();
  assert.ok(await page.getByRole('menuitem', { name: /this track/ }).first().isVisible(), 'tapping a track chip opens its menu');
  await page.keyboard.press('Escape');

  await page.screenshot({ path: `${out}touch-final.png` });
  assert.deepEqual(errors, [], 'no page errors');
  console.log('touch e2e passed');
} finally {
  await browser.close();
  await server.close();
}
