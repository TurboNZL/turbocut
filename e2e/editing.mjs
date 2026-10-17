// Timeline editing: wheel scrolling, one selection at a time, Split on the chosen track or caption, the add-track corner,
// text entrance, the first-use speech model window and installed-font detection.
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}e2e/.out/`, { recursive: true });
const server = await createServer({ root, server: { port: 5211, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
const ignorable = (m) => /rate limit|status of 403|Failed to load resource/.test(m); // the sandbox's anonymous GitHub rate limit, not the app
try {
  const fresh = async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, fps: 30 })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !ignorable(m.text()) && errors.push(m.text()));
    await page.goto('http://localhost:5211/');
    await page.waitForFunction(() => window.turbocutApp);
    await page.getByRole('button', { name: 'File' }).click();
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Import media…' }).click()]);
    await ch.setFiles(`${root}e2e/.media/src.webm`);
    await page.waitForFunction(() => window.turbocutApp.store.project.tracks[0].clips.length === 1);
    return page;
  };
  const blank = async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, fps: 30 })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:5211/');
    await page.waitForFunction(() => window.turbocutApp);
    return page;
  };
  const st = (page) => page.evaluate(() => {
    const s = window.turbocutApp.store;
    return { sel: s.selected, cue: s.selectedCue, active: s.activeTrack, tracks: s.project.tracks.map((t) => [t.name, t.clips.map((c) => [c.start, c.duration])]), cues: s.project.captions.map((c) => [c.text, c.start, c.end]) };
  });
  const cues = (page) => page.evaluate(() => {
    window.turbocutApp.store.edit((p) => { p.captions = [{ id: 'c1', start: 0, end: 60, text: 'one two three four', style: 'Default', words: [['one', 0, 12], ['two', 15, 28], ['three', 32, 45], ['four', 48, 60]].map(([text, start, end]) => ({ text, start, end })) }]; });
  });

  // ============================================================ 1. the wheel moves along the footage
  let page = await fresh();
  await page.evaluate(() => window.turbocutApp.store.setZoom(20));
  const tl = await page.locator('.tl-scroll').boundingBox();
  await page.mouse.move(tl.x + 300, tl.y + 80);
  const left0 = await page.$eval('.tl-scroll', (e) => e.scrollLeft);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(100);
  const left1 = await page.$eval('.tl-scroll', (e) => e.scrollLeft);
  console.log('wheel down: scrollLeft', left0, '->', left1);
  assert.ok(left1 - left0 >= 300, 'the plain wheel scrolls the timeline sideways');
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(100);
  assert.ok((await page.$eval('.tl-scroll', (e) => e.scrollLeft)) < left1, 'and back again');
  const zoom0 = await page.evaluate(() => window.turbocutApp.store.zoom);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  assert.ok((await page.evaluate(() => window.turbocutApp.store.zoom)) > zoom0, 'Ctrl + wheel still zooms');
  // Shift + wheel scrolls the tracks up and down once there are more than fit.
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.turbocutApp.actions.addTrack('video'));
  await page.mouse.move(tl.x + 300, tl.y + 80);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 150);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
  assert.ok((await page.$eval('.tl-scroll', (e) => e.scrollTop)) > 0, 'Shift + wheel scrolls the tracks vertically');
  await page.close();

  // ============================================================ 1b. adding a keyframe does not replay the panel's opening animation
  page = await fresh();
  await page.evaluate(() => { const s = window.turbocutApp.store; s.select(s.project.tracks[0].clips[0].id); });
  await page.locator('.ks-fold > summary').click(); // the person opens the fold: this one may animate
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__fold = document.querySelector('.ks-fold'); window.__seen = new Set(); window.__t = setInterval(() => { for (const a of document.getAnimations()) { const t = a.effect?.target; if (t && t.closest?.('.ks-fold, .insp')) window.__seen.add(`${t.className}:${a.animationName ?? a.transitionProperty}`); } }, 8); });
  await page.getByRole('button', { name: 'Keyframe X', exact: true }).click(); // from the inspector
  await page.locator('.ks-label').getByText('Y', { exact: true }).click(); // from the dopesheet
  await page.keyboard.press('k');
  await page.waitForTimeout(700);
  const kf = await page.evaluate(() => { clearInterval(window.__t); return { sameFold: window.__fold === document.querySelector('.ks-fold'), open: document.querySelector('.ks-fold').open, anims: [...window.__seen].filter((a) => /tk-|ks-/.test(a) && !/transition|background|opacity$|box-shadow|border|color/.test(a.split(':')[1] ?? '')) }; });
  console.log('keyframe added, fold:', JSON.stringify(kf));
  assert.ok(kf.sameFold && kf.open, 'the fold is the same element and stays open');
  assert.deepEqual(kf.anims, [], 'no panel animation runs when a keyframe is added');
  await page.close();

  // ============================================================ 2. the add-track button is in the corner, and works
  page = await fresh();
  const corner = await page.getByRole('button', { name: 'Add a track' }).boundingBox();
  const ruler = await page.locator('.tl-ruler').boundingBox();
  const head = await page.locator('.tl-head', { hasText: 'V1' }).boundingBox();
  console.log('corner', JSON.stringify(corner), 'ruler', JSON.stringify(ruler), 'V1 label', JSON.stringify(head));
  assert.ok(Math.abs(corner.x - head.x) < 2 && corner.width <= head.width + 2, 'it sits above the track labels');
  assert.ok(corner.y >= ruler.y - 1 && corner.y + corner.height <= ruler.y + ruler.height + 1, 'in the ruler row, left of the time marks');
  assert.equal(await page.getByRole('button', { name: '+ Track' }).count(), 0, 'and it is gone from the edit bar');
  await page.getByRole('button', { name: 'Add a track' }).click();
  await page.getByRole('menuitem', { name: 'Add an audio track' }).click();
  assert.deepEqual((await st(page)).tracks.map((t) => t[0]), ['V1', 'A1', 'A2']);
  // it stays put when the timeline is scrolled sideways, and survives a zoom
  await page.evaluate(() => window.turbocutApp.store.setZoom(20));
  await page.$eval('.tl-scroll', (e) => (e.scrollLeft = 300));
  await page.waitForTimeout(100);
  const moved = await page.getByRole('button', { name: 'Add a track' }).boundingBox();
  assert.ok(Math.abs(moved.x - corner.x) < 2, 'the corner button stays in view while scrolled');
  await page.close();

  // ============================================================ 3. one selection at a time
  page = await fresh();
  await cues(page);
  await page.evaluate(() => { const s = window.turbocutApp.store; s.select(s.project.tracks[0].clips[0].id); });
  await page.locator('.tl-cue').first().click();
  let s = await st(page);
  assert.equal(s.sel, null, 'choosing a caption lets go of the clip');
  assert.equal(s.cue, 'c1');
  assert.equal(await page.locator('.tl-clip.sel').count(), 1, 'only one thing is highlighted');
  await page.locator('.tl-track.tl-video .tl-clip').first().click();
  s = await st(page);
  assert.equal(s.cue, null, 'choosing a clip lets go of the caption');
  assert.ok(s.sel);
  // Delete after picking the caption removes the caption, not the picture
  await page.locator('.tl-cue').first().click();
  await page.keyboard.press('Delete');
  s = await st(page);
  assert.equal(s.cues.length, 0, 'Delete removes the selected caption');
  assert.deepEqual(s.tracks[0][1].length, 1, 'and leaves the video alone');
  await cues(page);
  await page.locator('.tl-cue').first().click();
  // pressing on empty timeline lets go of everything; so does Escape
  await page.locator('.tl-track.tl-video').first().click({ position: { x: 900, y: 20 } });
  s = await st(page);
  assert.deepEqual([s.sel, s.cue], [null, null], 'a press on empty track space selects nothing');
  await page.locator('.tl-cue').first().click();
  await page.keyboard.press('Escape');
  s = await st(page);
  assert.deepEqual([s.sel, s.cue], [null, null], 'Escape selects nothing');
  await page.close();

  // ============================================================ 4. Split cuts only what is chosen
  page = await fresh();
  await cues(page);
  await page.evaluate(() => window.turbocutApp.actions.addTrack('video')); // V2 with a clip over the same time
  await page.evaluate(async () => {
    const a = window.turbocutApp;
    const { addClip, createClip } = await import('/src/core/timeline.ts');
    const asset = Object.values(a.store.project.assets)[0];
    const v2 = a.store.project.tracks.find((t) => t.name === 'V2');
    a.store.edit((p) => addClip(p, v2.id, createClip(asset.id, 0, 180))); // picture only, over the same 6 seconds
  });
  const base = await st(page);
  console.log('before splits:', JSON.stringify(base.tracks));
  // (a) a selected caption: only it is cut
  await page.locator('.tl-cue').first().click();
  await page.evaluate(() => window.turbocutApp.store.seek(30));
  await page.keyboard.press('s');
  s = await st(page);
  assert.deepEqual(s.cues, [['one two', 0, 30], ['three four', 30, 60]], 'S cuts the selected caption at the playhead, between words');
  assert.deepEqual(s.tracks, base.tracks, 'and no clip');
  // (b) a selected clip: that clip and its own sound, not the other video track
  await page.evaluate(() => { const s = window.turbocutApp.store; const v1 = s.project.tracks.find((t) => t.name === 'V1'); s.select(v1.clips[0].id); s.seek(90); });
  await page.keyboard.press('s');
  s = await st(page);
  const byName = Object.fromEntries(s.tracks);
  assert.equal(byName.V1.length, 2, 'the selected clip is cut');
  assert.equal(byName.A1.length, 2, 'with its sound');
  assert.equal(byName.V2.length, 1, 'the other video track is left whole');
  assert.equal(s.cues.length, 2, 'and the captions too');
  // (c) nothing selected, V2 is the active track: only V2 is cut
  await page.evaluate(() => { const s = window.turbocutApp.store; s.clearSelection(); s.setActiveTrack(s.project.tracks.find((t) => t.name === 'V2').id); s.seek(40); });
  await page.keyboard.press('s');
  s = await st(page);
  const b2 = Object.fromEntries(s.tracks);
  assert.equal(b2.V2.length, 2, 'with nothing selected Split cuts the active track');
  assert.equal(b2.V1.length, 2, 'and not the others (V1 at 40 would have been cut)');
  // (d) the CC row is a track too: clicking its label and pressing S cuts the caption under the playhead
  await page.getByRole('button', { name: 'Caption track' }).click();
  await page.evaluate(() => window.turbocutApp.store.seek(15));
  await page.keyboard.press('s');
  s = await st(page);
  assert.deepEqual(s.cues.map((c) => c[0]), ['one', 'two', 'three four'], 'on the caption row S cuts the caption at the playhead');
  // a one-word caption cannot be cut, and says so
  await page.evaluate(() => window.turbocutApp.store.seek(5));
  await page.keyboard.press('s');
  assert.match(await page.locator('.status').textContent(), /one word/);
  // undo brings it back in one step
  await page.evaluate(() => window.turbocutApp.store.undo());
  assert.equal((await st(page)).cues.length, 3);
  await page.close();

  // ============================================================ 5. text layers: pop in, or stay still
  page = await fresh();
  await page.evaluate(() => { document.activeElement?.blur(); });
  await page.keyboard.press('t');
  const bright = async (frame) => {
    await page.evaluate((f) => window.turbocutApp.store.seek(f), frame);
    await page.waitForTimeout(500);
    return page.evaluate(() => { const c = window.turbocutApp.player.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 600) n++; return n; });
  };
  const textStart = await page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips.find((c) => c.text)?.start ?? 0);
  assert.equal(await page.getByLabel('Entrance animation').inputValue(), 'bounce', 'a new text layer pops in like captions');
  const popFirst = await bright(textStart);
  await page.getByLabel('Entrance animation').selectOption('none');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.project.tracks.flatMap((t) => t.clips).find((c) => c.text).text.animation.type), 'none');
  const stillFirst = await bright(textStart);
  console.log('text pixels on its first frame: bounce', popFirst, ' none', stillFirst);
  assert.ok(stillFirst > 300 && popFirst < 50, 'static text is fully there on its first frame; the bounce starts from nothing');
  await page.getByLabel('Entrance animation').selectOption('bounce');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.project.tracks.flatMap((t) => t.clips).find((c) => c.text).text.animation.type), 'bounce');
  await page.close();

  // ============================================================ 6. first time: ask which speech model
  page = await blank();
  await page.getByRole('tab', { name: 'Captions', exact: true }).click();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.transcribe.model), 'onnx-community/whisper-small_timestamped', 'a computer defaults to the accurate model');
  await page.getByRole('button', { name: 'Generate captions' }).click();
  await page.getByRole('dialog', { name: 'Choose a speech model' }).waitFor();
  assert.ok(await page.getByRole('radio', { name: /Accurate/ }).isChecked(), 'the accurate model is preselected on a computer');
  await page.getByRole('radio', { name: /Fast/ }).check();
  await page.getByRole('button', { name: 'Use this model' }).click();
  await page.waitForFunction(() => window.turbocutApp.store.settings.transcribe.modelChosen);
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.transcribe.model), 'onnx-community/whisper-tiny.en_timestamped');
  assert.equal(await page.getByRole('dialog').count(), 0, 'the window closes');
  await page.waitForFunction(() => /Add a clip with audio first/.test(document.querySelector('.status')?.textContent ?? ''));
  // asked once only
  await page.getByRole('button', { name: 'Generate captions' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('dialog', { name: 'Choose a speech model' }).count(), 0, 'it does not ask again');
  await page.close();
  // closing the window with × cancels and asks again next time
  page = await blank();
  await page.getByRole('tab', { name: 'Captions', exact: true }).click();
  await page.getByRole('button', { name: 'Generate captions' }).click();
  await page.getByRole('dialog', { name: 'Choose a speech model' }).getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.transcribe.modelChosen), false, 'closing the window chooses nothing');
  assert.equal(await page.getByRole('button', { name: 'Generate captions' }).isEnabled(), true);
  await page.close();

  // ============================================================ 7. installed fonts
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, fps: 30 });
  await ctx.addInitScript(() => { window.queryLocalFonts = async () => [{ family: 'Fake Sans', style: 'Regular' }, { family: 'Fake Sans', style: 'Bold' }, { family: 'Zed Mono', style: 'Regular' }]; });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5211/');
  await page.waitForFunction(() => window.turbocutApp);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Fonts' }).click();
  await page.getByRole('button', { name: 'Open the font manager…' }).click();
  await page.getByRole('button', { name: 'Find installed fonts' }).click();
  await page.getByText('Fake Sans', { exact: true }).waitFor();
  assert.ok(await page.getByText('Zed Mono', { exact: true }).isVisible(), 'the installed fonts are listed');
  await page.getByLabel('Search installed fonts').fill('zed');
  assert.equal(await page.getByText('Fake Sans', { exact: true }).count(), 0, 'and can be searched');
  const choices = await page.evaluate(async () => { const { fontChoices } = await import('/src/app/fonts.ts'); return fontChoices(); });
  assert.ok(choices.includes('Fake Sans') && choices.includes('Arial Black'), 'every font box now offers them');
  await ctx.close();

  assert.deepEqual(errors, [], 'no page errors');
  console.log('editing e2e passed');
} finally {
  await browser.close();
  await server.close();
}
