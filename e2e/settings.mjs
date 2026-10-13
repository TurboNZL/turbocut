// Settings dialog, hotkey editor, snapping, wheel zoom, track order and the update check, in a desktop browser.
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const release = (tag, extra = {}) => ({ tag_name: tag, html_url: `https://github.com/TurboNZL/turbocut/releases/tag/${tag}`, body: `Notes for ${tag}`, published_at: '2026-10-13T00:00:00Z', draft: false, prerelease: true, assets: [{ name: `turbocut-${tag.slice(1)}-android.apk`, browser_download_url: 'https://example.com/a.apk', size: 1 }], ...extra });
  let releases = [release('v2026.10.1')];
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(releases) }));
  const load = async () => {
    await page.goto('http://localhost:5199/');
    await page.waitForFunction(() => window.turbocutApp);
  };
  const importTwo = () => page.evaluate(async () => {
    const blob = await (await fetch('/e2e/.media/src.webm')).blob();
    await window.turbocutApp.importMedia([new File([blob], 'clip.webm', { type: 'video/webm' })]);
    // clip A is frames 0-179; split it, delete nothing, then move the second half 20 frames away to leave a gap
    const s = window.turbocutApp.store; s.seek(90); window.turbocutApp.split();
    const second = s.project.tracks[0].clips[1];
    s.edit(() => { second.start += 20; });
    const audio2 = s.project.tracks[1].clips[1]; s.edit(() => { audio2.start += 20; });
    s.select(null);
  });
  await load();
  await importTwo();

  // ---- 1. Settings dialog opens from the gear, and a changed setting survives a reload
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.waitForSelector('.settings');
  const tabs = await page.$$eval('.settings-nav .tab', (els) => els.map((e) => e.textContent));
  assert.deepEqual(tabs, ['General', 'Layout', 'Fonts', 'Guides', 'Keys', 'Captions', 'Updates', 'Device', 'About']);
  const track = page.getByRole('combobox', { name: 'Track order' });
  await track.selectOption('audio');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.videoOnTop), false);
  const kinds = await page.$$eval('.tl-track', (els) => els.map((e) => (e.className.match(/tl-(video|audio|caption)/) ?? [])[1]));
  console.log('track order with audio on top:', kinds.join(','));
  assert.deepEqual(kinds, ['audio', 'video', 'caption'], 'audio tracks drawn above video when the setting says so');
  await track.selectOption('video');
  const kinds2 = await page.$$eval('.tl-track', (els) => els.map((e) => (e.className.match(/tl-(video|audio|caption)/) ?? [])[1]));
  assert.deepEqual(kinds2, ['video', 'audio', 'caption']);
  await page.screenshot({ path: `${out}settings-general.png` });

  // ---- 2. Snapping: a clip dropped one frame from its neighbour lands on the edge only when snapping is on
  const dragSecondClipLeft = async () => {
    const r = await page.evaluate(() => { const c = document.querySelectorAll('.tl-track.tl-video .tl-clip')[1].getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
    await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.w / 2 - 20, r.y + r.h / 2, { steps: 4 });
    await page.mouse.move(r.x + r.w / 2 - 57, r.y + r.h / 2, { steps: 6 }); // 57 px = 19 frames: start 110 -> 91, one frame from the neighbour's end at 90
    await page.mouse.up();
    return page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips[1].start);
  };
  await page.evaluate(() => window.turbocutApp.store.updateSettings({ snapping: true }));
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('.dlg-backdrop')?.remove());
  const startBefore = await page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips[1].start);
  const snapped = await dragSecondClipLeft();
  console.log('clip start before', startBefore, 'with snapping:', snapped);
  assert.equal(snapped, 90, 'snaps exactly onto the neighbouring clip end');
  await page.evaluate((b) => { window.turbocutApp.store.edit((p) => { for (const t of p.tracks) { const c = t.clips[1]; if (c) c.start = b; } }); }, startBefore);
  await page.evaluate(() => window.turbocutApp.store.updateSettings({ snapping: false }));
  const free = await dragSecondClipLeft();
  console.log('with snapping off:', free);
  assert.ok(free > 90 && free <= 92, `without snapping the clip stays where it was dropped (got ${free})`);
  // the hotkey N toggles it
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('n');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.snapping), true, 'N turns snapping back on');

  // ---- 3. Hotkey editor: add X to Split through the UI, steal Space for Snap, persist across a reload
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.locator('.settings-nav').getByRole('tab', { name: 'Keys', exact: true }).click();
  const rowFor = (label) => page.locator('.key-row', { hasText: label }).first();
  await rowFor('Split at the playhead').getByRole('button', { name: 'Add' }).click();
  await page.keyboard.press('x');
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.turbocutApp.hotkeys.keysFor('split')), ['S', 'X']);
  await rowFor('Turn snapping on or off').getByRole('button', { name: 'Add' }).click();
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.turbocutApp.hotkeys.keysFor('play')), [], 'Space was taken from Play');
  assert.match(await page.locator('.settings-body .hint').first().textContent(), /moved here from "Play or pause"/);
  await page.screenshot({ path: `${out}settings-keys.png` });
  await page.evaluate(() => document.querySelector('.dlg-backdrop')?.remove());
  await load(); // reload: the bindings must come back from storage
  assert.deepEqual(await page.evaluate(() => window.turbocutApp.hotkeys.keysFor('split')), ['S', 'X']);
  assert.deepEqual(await page.evaluate(() => window.turbocutApp.hotkeys.keysFor('snap')), ['N', 'Space']);
  await importTwo();
  await page.evaluate(() => { window.turbocutApp.store.select(null); window.turbocutApp.store.seek(40); });
  const clipsBefore = await page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips.length);
  await page.keyboard.press('x');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips.length), clipsBefore + 1, 'the new shortcut X splits');
  await page.evaluate(() => window.turbocutApp.store.seek(20)); // a different frame, inside the first clip
  await page.keyboard.press('s');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips.length), clipsBefore + 2, 'the default S still splits');
  // reset all
  await page.evaluate(() => window.turbocutApp.hotkeys.resetAll());
  assert.deepEqual(await page.evaluate(() => window.turbocutApp.hotkeys.keysFor('play')), ['Space']);

  // ---- 4. Ctrl+wheel and Alt+wheel zoom, anchored at the cursor
  for (const mod of ['Control', 'Alt']) {
    await page.evaluate(() => window.turbocutApp.store.setZoom(3));
    const box = await page.evaluate(() => { const r = document.querySelector('.tl-scroll').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const px = box.x + 400, py = box.y + 90;
    const frameAt = () => page.evaluate((x) => { const s = document.querySelector('.tl-scroll'); const z = window.turbocutApp.store.zoom; return (s.scrollLeft + x - s.getBoundingClientRect().left - 56) / z; }, px);
    const f0 = await frameAt(), z0 = await page.evaluate(() => window.turbocutApp.store.zoom);
    await page.mouse.move(px, py);
    await page.keyboard.down(mod);
    await page.mouse.wheel(0, -300);
    await page.keyboard.up(mod);
    await page.waitForTimeout(100);
    const z1 = await page.evaluate(() => window.turbocutApp.store.zoom), f1 = await frameAt();
    console.log(`${mod}+wheel up: zoom ${z0} -> ${z1.toFixed(2)}, frame under the cursor ${f0.toFixed(1)} -> ${f1.toFixed(1)}`);
    assert.ok(z1 > z0 * 1.5, `${mod}+wheel up zooms in`);
    assert.ok(Math.abs(f1 - f0) < 2, 'the frame under the cursor stays put');
    await page.keyboard.down(mod);
    await page.mouse.wheel(0, 600);
    await page.keyboard.up(mod);
    await page.waitForTimeout(100);
    assert.ok((await page.evaluate(() => window.turbocutApp.store.zoom)) < z1, `${mod}+wheel down zooms out`);
  }
  // a plain wheel must not zoom
  const zPlain = await page.evaluate(() => window.turbocutApp.store.zoom);
  await page.mouse.wheel(0, 200);
  assert.equal(await page.evaluate(() => window.turbocutApp.store.zoom), zPlain);

  // ---- 5. Updates tab with mocked GitHub answers
  const openUpdates = async () => {
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.locator('.settings-nav').getByRole('tab', { name: 'Updates', exact: true }).click();
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await page.waitForFunction(() => /newest version|is available|No releases|Could not/.test(document.querySelector('.settings-body').textContent));
    return page.locator('.settings-body').textContent();
  };
  const version = await page.evaluate(() => window.turbocutApp.store && document.querySelector('.settings-body') ? '' : '');
  void version;
  releases = [release('v2026.10.1'), release('build-1')];
  let text = await openUpdates();
  console.log('updates (same version):', text.replace(/\s+/g, ' ').slice(0, 120));
  assert.match(text, /newest version/);
  await page.evaluate(() => document.querySelector('.dlg-backdrop')?.remove());
  releases = [release('v2026.10.2'), release('v2026.10.12', { published_at: '2026-10-01T00:00:00Z' }), release('v2026.9.99')];
  text = await openUpdates();
  console.log('updates (newer):', text.replace(/\s+/g, ' ').slice(0, 160));
  assert.match(text, /Version 2026\.10\.12 is available/, 'the highest version wins, not the latest publish date');
  assert.ok(await page.getByRole('button', { name: 'Reload to get it' }).count(), 'web build offers a reload');
  await page.screenshot({ path: `${out}settings-updates.png` });
  await page.evaluate(() => document.querySelector('.dlg-backdrop')?.remove());

  assert.deepEqual(errors, [], 'no page errors');
  console.log('settings e2e passed');
} finally {
  await browser.close();
  await server.close();
}
