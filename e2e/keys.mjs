// Text layers and the keyframe editor, including keyframes on blur and on audio volume.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5204, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
/** The keyframe section is folded until wanted (it opens by itself for a clip that already has keys). */
const openFold = async (page) => {
  const open = await page.locator('.ks-fold').evaluate((d) => d.open);
  if (!open) await page.locator('.ks-fold > summary').click();
  await page.locator('.ks-row').first().waitFor();
};
try {
  const newPage = async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:5204/');
    await page.waitForFunction(() => window.turbocutApp);
    return page;
  };
  // What the preview canvas shows: how many bright pixels, where their centre is, how many are red, and how sharp it is.
  const look = async (page, frame) => {
    await page.evaluate((f) => window.turbocutApp.store.seek(f), frame);
    await page.waitForTimeout(700);
    return page.evaluate(() => {
      const c = window.turbocutApp.player.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0, lit = 0, sx = 0, red = 0, lap = 0;
      for (let y = 1; y < c.height - 1; y++) for (let x = 1; x < c.width - 1; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 600) n++;
        if (d[i] + d[i + 1] + d[i + 2] > 150) { lit++; sx += x; }
        if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++;
        const g = (k) => (d[k] + d[k + 1] + d[k + 2]) / 3;
        lap += Math.abs(4 * g(i) - g(i - 4) - g(i + 4) - g(i - c.width * 4) - g(i + c.width * 4));
      }
      return { bright: n, cx: lit ? sx / lit / c.width : 0.5, red, sharp: lap / (c.width * c.height) };
    });
  };

  // ============================================================ text layer
  let page = await newPage();
  await page.keyboard.press('t'); // Add a text layer
  let st = await page.evaluate(() => { const s = window.turbocutApp.store; const c = s.project.tracks[0].clips[0]; return { n: s.project.tracks[0].clips.length, text: c?.text?.content, dur: c?.duration, sel: s.selected === c?.id }; });
  assert.deepEqual(st, { n: 1, text: 'Your text', dur: 180, sel: true }, 'T adds a selected 3 s text layer');
  const base = await look(page, 30);
  console.log('text on black:', JSON.stringify(base));
  assert.ok(base.bright > 300, 'the words are drawn');
  assert.ok(Math.abs(base.cx - 0.5) < 0.05, 'and centred');

  // edit the words and the colour through the inspector
  await page.getByRole('textbox', { name: 'Text' }).fill('A much longer line of text here');
  const longer = await look(page, 30);
  assert.ok(longer.bright > base.bright * 1.3, 'more words, more pixels');
  await page.getByLabel('Fill').evaluate((el) => { el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  const redLook = await look(page, 30);
  console.log('after making it red:', JSON.stringify(redLook));
  assert.ok(redLook.red > 300 && redLook.bright < longer.bright * 0.2, 'the fill is now red (red is dim, so few pixels count as bright)');
  await page.screenshot({ path: `${out}text-layer.png` });

  // ---- keyframe editor: X moves the text across the frame
  await page.getByRole('tab', { name: 'Clip', exact: true }).click(); // keyframes now sit under the Clip settings, in a fold
  await openFold(page);
  assert.equal(await page.locator('.ks-row').count(), 7, 'a video layer shows its 7 animatable settings');
  const xRow = page.locator('.ks-row[data-param="x"]');
  await page.evaluate(() => window.turbocutApp.store.seek(0));
  await xRow.getByRole('button').first().click(); // key at frame 0
  await page.evaluate(() => window.turbocutApp.store.seek(60));
  await xRow.getByRole('button').first().click(); // key at frame 60
  assert.equal(await xRow.locator('.ks-key').count(), 2, 'two diamonds');
  // value of the second key: move far to the right
  await xRow.locator('.ks-key').nth(1).click();
  await page.getByLabel('Keyframe value').fill('300');
  await page.getByLabel('Keyframe value').dispatchEvent('change');
  await xRow.locator('.ks-key').nth(0).click();
  await page.getByLabel('Keyframe value').fill('-300');
  await page.getByLabel('Keyframe value').dispatchEvent('change');
  // frame 8, not 0: the bounce entrance starts at scale 0, so nothing is drawn on the very first frame
  const at0 = await look(page, 8), at30 = await look(page, 30), at60 = await look(page, 60);
  console.log(`text centre x at frames 8/30/60: ${at0.cx.toFixed(2)} ${at30.cx.toFixed(2)} ${at60.cx.toFixed(2)}`);
  assert.ok(at0.cx < at30.cx - 0.1 && at30.cx < at60.cx - 0.1, 'the text travels left to right through the middle');
  assert.ok(Math.abs(at30.cx - 0.5) < 0.1, 'halfway through the keyframes it is in the middle');

  // dragging a diamond changes its time; Ctrl+Z puts it back
  const keyTimes = () => page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips[0].keys.x.map((k) => k.t));
  assert.deepEqual(await keyTimes(), [0, 60]);
  await xRow.locator('.ks-key').nth(1).scrollIntoViewIfNeeded(); // the dopesheet sits below the clip settings now
  const d2 = await xRow.locator('.ks-key').nth(1).boundingBox();
  await page.mouse.move(d2.x + d2.width / 2, d2.y + d2.height / 2);
  await page.mouse.down();
  await page.mouse.move(d2.x + d2.width / 2 - 40, d2.y + d2.height / 2, { steps: 6 });
  await page.mouse.up();
  const dragged = await keyTimes();
  console.log('key times after dragging the second diamond left:', JSON.stringify(dragged));
  assert.equal(dragged[0], 0);
  assert.ok(dragged[1] < 60 && dragged[1] > 20, 'the diamond moved in time');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await keyTimes(), [0, 60], 'undo restores the key time');
  await page.keyboard.press('Control+Shift+z');
  const afterRedo = await keyTimes();
  assert.ok(afterRedo[1] < 60);

  // next / previous keyframe
  await page.evaluate(() => window.turbocutApp.store.seek(5));
  await page.keyboard.press('.');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.playhead), afterRedo[1], '. jumps to the next keyframe');
  await page.keyboard.press(',');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.playhead), 0, ', jumps back to the previous one');
  await page.keyboard.press(',');
  assert.match(await page.locator('.status').textContent(), /No earlier keyframe/);
  // easing "hold" makes it step instead of glide
  await xRow.locator('.ks-key').nth(0).click();
  await page.getByLabel('Easing to the next keyframe').selectOption('hold');
  const held = await look(page, Math.round(afterRedo[1] / 2));
  assert.ok(held.cx < 0.35, `with Hold the text stays at the first key until the next one (x=${held.cx.toFixed(2)})`);
  await page.screenshot({ path: `${out}keys-panel.png` });

  // deleting the last keyframe keeps its value as the static one
  await xRow.locator('.ks-key').nth(1).click();
  await page.getByRole('button', { name: 'Delete keyframe' }).click();
  await xRow.locator('.ks-key').nth(0).click();
  await page.getByRole('button', { name: 'Delete keyframe' }).click();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips[0].keys.x), undefined, 'no keys left');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips[0].base.x), -300, 'the last value stays as the position');

  // ============================================================ blur keyframes on video, volume keyframes on audio
  page = await newPage();
  await page.evaluate(async () => {
    const blob = await (await fetch('/e2e/.media/src.webm')).blob();
    await window.turbocutApp.importMedia([new File([blob], 'clip.webm', { type: 'video/webm' })]);
  });
  const clipIds = await page.evaluate(() => window.turbocutApp.store.project.tracks.map((t) => t.clips[0].id));
  await page.evaluate((id) => window.turbocutApp.store.select(id), clipIds[0]);
  await page.getByRole('tab', { name: 'Clip', exact: true }).click(); // keyframes now sit under the Clip settings, in a fold
  await openFold(page);
  const blurRow = page.locator('.ks-row[data-param="blur"]');
  await page.evaluate(() => window.turbocutApp.store.seek(0));
  await blurRow.getByRole('button').first().click();
  await page.evaluate(() => window.turbocutApp.store.seek(40));
  await blurRow.getByRole('button').first().click();
  await blurRow.locator('.ks-key').nth(1).click();
  await page.getByLabel('Keyframe value').fill('60');
  await page.getByLabel('Keyframe value').dispatchEvent('change');
  const sharp0 = await look(page, 0), sharp40 = await look(page, 40);
  console.log(`sharpness at 0 / 40 with blur keyed 0 -> 60: ${sharp0.sharp.toFixed(2)} / ${sharp40.sharp.toFixed(2)}`);
  assert.ok(sharp40.sharp < sharp0.sharp * 0.6, 'the picture blurs as the blur keyframes rise');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.project.tracks[0].clips[0].effects.length), 1, 'blur is stored as an effect with keys');

  // audio volume: fades from full to silent over two seconds
  await page.evaluate((id) => window.turbocutApp.store.select(id), clipIds[1]);
  assert.equal(await page.locator('.ks-row').count(), 1, 'an audio clip shows just Volume');
  const volRow = page.locator('.ks-row[data-param="volume"]');
  await page.evaluate(() => window.turbocutApp.store.seek(0));
  await volRow.getByRole('button').first().click();
  await page.evaluate(() => window.turbocutApp.store.seek(60));
  await volRow.getByRole('button').first().click();
  await volRow.locator('.ks-key').nth(1).click();
  await page.getByLabel('Keyframe value').fill('0');
  await page.getByLabel('Keyframe value').dispatchEvent('change');
  const exp = await page.evaluate(() => window.turbocutApp.exportForTest());
  const file = `${out}keys-volume.${exp.container}`;
  writeFileSync(file, Buffer.from(exp.b64, 'base64'));
  const level = (from, len) => Number(/mean_volume: (-?[\d.]+) dB/.exec(execFileSync('sh', ['-c', `ffmpeg -ss ${from} -t ${len} -i '${file}' -vn -af volumedetect -f null - 2>&1`], { encoding: 'utf8' }))?.[1] ?? -999);
  const early = level(0, 0.4), late = level(2.5, 0.5);
  console.log(`export level 0-0.4 s ${early} dB, 2.5-3 s ${late} dB (volume keyed 100% -> 0% over 2 s)`);
  assert.ok(early > late + 20, 'the exported audio fades out as the volume keyframes say');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('keys e2e passed');
} finally {
  await browser.close();
  await server.close();
}
