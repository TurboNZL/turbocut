// Drives the real TurboCut UI in headless Chromium: import, split, undo, play, caption, export, theme. Writes screenshots to e2e/.out/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5190, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--js-flags=--expose-gc'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/404|favicon|fonts|jsdelivr|net::ERR/.test(m.text()) && errors.push(m.text()));
  await page.goto('http://localhost:5190/');
  await page.waitForFunction(() => window.turbocutApp);

  const app = (fn, arg) => page.evaluate(fn, arg);
  // 1. import
  await app(async () => {
    const blob = await (await fetch('/e2e/.media/src.webm')).blob();
    await window.turbocutApp.importMedia([new File([blob], 'clip.webm', { type: 'video/webm' })]);
  });
  let st = await app(() => { const p = window.turbocutApp.store.project; return { v: p.tracks[0].clips.length, a: p.tracks[1].clips.length, dur: p.tracks[0].clips[0]?.duration, link: p.tracks[0].clips[0]?.link === p.tracks[1].clips[0]?.link }; });
  assert.deepEqual(st, { v: 1, a: 1, dur: 180, link: true }, 'import adds a linked video+audio pair');

  // 2. split with the S key at frame 60, both halves of the pair
  await app(() => window.turbocutApp.store.seek(60));
  await page.keyboard.press('s');
  st = await app(() => { const p = window.turbocutApp.store.project; return [p.tracks[0].clips.map((c) => [c.start, c.duration]), p.tracks[1].clips.length]; });
  assert.deepEqual(st, [[[0, 60], [60, 120]], 2], 'S splits video and linked audio');

  // 3. delete the first half with ripple, then undo
  await app(() => window.turbocutApp.store.select(window.turbocutApp.store.project.tracks[0].clips[0].id));
  await page.keyboard.press('Shift+Delete');
  st = await app(() => window.turbocutApp.store.project.tracks[0].clips.map((c) => [c.start, c.duration]));
  assert.deepEqual(st, [[0, 120]], 'ripple delete closes the gap');
  await page.keyboard.press('Control+z');
  st = await app(() => window.turbocutApp.store.project.tracks[0].clips.length);
  assert.equal(st, 2, 'undo brings the clip back');

  // 4. play: the playhead must move with the clock and the canvas must show picture
  await app(() => window.turbocutApp.store.seek(0));
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  const played = await app(() => ({ frame: window.turbocutApp.store.playhead, playing: window.turbocutApp.store.playing }));
  await page.keyboard.press('Space');
  console.log('playback reached frame', played.frame, 'after ~1.5 s');
  assert.ok(played.playing && played.frame > 10, `playback should advance, got ${JSON.stringify(played)}`);
  const lit = await app(() => { const c = window.turbocutApp.player.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 400) n += d[i] + d[i + 1] + d[i + 2] > 60 ? 1 : 0; return n / (d.length / 400); });
  assert.ok(lit > 0.3, `preview should show picture, lit fraction ${lit}`);

  // 5. caption, then screenshots
  await app(() => {
    const s = window.turbocutApp.store;
    s.seek(30);
    s.edit((p) => p.captions.push({ id: 'c1', start: 20, end: 90, text: 'Bro someone\'s hitting a jig', style: 'Default - Yellow' }));
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}ui-desktop.png` });

  // 5b. your real caption font and Kdenlive styles (only when the font file is present locally; it is not in the repo)
  const fontUrl = '/e2e/.media/SquadLatin-Black.otf';
  if ((await page.request.get(`http://localhost:5190${fontUrl}`)).ok()) {
    const shot = await app(async (url) => {
      const app = window.turbocutApp;
      const fams = await app.importFont(new File([await (await fetch(url)).blob()], 'SquadLatin-Black.otf'));
      const { presetFromAss } = await import('/src/captions/presets.ts');
      const { dialogueToCues, parseAss } = await import('/src/captions/ass.ts');
      const ass = await (await fetch('/test/fixtures/sample.ass')).text();
      app.store.setPreset(presetFromAss('Prisma', ass), false);
      app.store.edit((p) => (p.captions = dialogueToCues(parseAss(ass).dialogue, p.fps)));
      app.store.seek(Math.round(2.9 * 30)); // "Oh, he's hitting a" in the red style, 4 frames into its bounce
      await new Promise((r) => setTimeout(r, 1200));
      return { fams, png: app.player.canvas.toDataURL('image/png') };
    }, fontUrl);
    console.log('font families registered:', shot.fams.join(' | '));
    writeFileSync(`${out}caption-real-font.png`, Buffer.from(shot.png.split(',')[1], 'base64'));
  }

  // 6. theme switch through the real turbothemes engine: attributes and the page colour must change
  const look = () => app(() => ({ theme: document.documentElement.dataset.theme, ui: document.documentElement.dataset.ui, bg: getComputedStyle(document.body).backgroundColor, btn: getComputedStyle(document.querySelector('.btn')).borderRadius }));
  const before = await look();
  await app(() => window.turbocutApp.themes.apply({ theme: 'nord', ui: 'win11' }));
  await page.waitForTimeout(300);
  const after = await look();
  console.log('theme', JSON.stringify(before), '->', JSON.stringify(after));
  assert.equal(after.theme, 'nord');
  assert.equal(after.ui, 'win11');
  assert.notEqual(after.bg, before.bg, 'page colour follows the palette');
  await page.screenshot({ path: `${out}ui-desktop-nord-win11.png` });
  await app((b) => window.turbocutApp.themes.apply({ theme: b.theme, ui: b.ui }), before);

  // 7. export through the UI path, capture the download
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), app(() => window.turbocutApp.runExport())]);
  const file = `${out}app-export.webm`;
  await download.saveAs(file);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }));
  const v = probe.streams.find((s) => s.codec_type === 'video');
  assert.equal(`${v.width}x${v.height}`, '1080x1920');
  assert.equal(Number(v.nb_read_frames), 180, 'export is the full 6 s');
  console.log('export OK:', v.codec_name, v.nb_read_frames, 'frames,', probe.streams.some((s) => s.codec_type === 'audio') ? 'with audio' : 'NO AUDIO');

  // 8. phone-size screenshot
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => errors.push('phone: ' + e.message));
  await pp.goto('http://localhost:5190/');
  await pp.waitForFunction(() => window.turbocutApp);
  await pp.evaluate(async () => {
    const blob = await (await fetch('/e2e/.media/src.webm')).blob();
    await window.turbocutApp.importMedia([new File([blob], 'clip.webm', { type: 'video/webm' })]);
    window.turbocutApp.store.seek(40);
  });
  await pp.waitForTimeout(800);
  await pp.screenshot({ path: `${out}ui-phone.png` });
  // Force garbage collection so unclosed decoder frames (a leak) are reported now, not at some random later time.
  for (const pg of [page, pp]) for (let i = 0; i < 3; i++) { await pg.evaluate(() => window.gc()); await pg.waitForTimeout(150); }
  assert.deepEqual(errors, [], 'no page errors');
  console.log('app e2e passed');
} finally {
  await browser.close();
  await server.close();
}
