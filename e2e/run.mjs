// Runs the real export pipeline in headless Chromium and writes the result to e2e/.out/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}e2e/.out`, { recursive: true });
const server = await createServer({ root, server: { port: 5188, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const captions of [false, true]) {
    const page = await browser.newPage();
    page.on('console', (m) => console.log('[page]', m.text()));
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto('http://localhost:5188/e2e/index.html');
    await page.waitForFunction(() => typeof window.run === 'function');
    const r = await page.evaluate((o) => window.run(o), { captions });
    const name = captions ? 'captions' : 'plain';
    writeFileSync(`${root}e2e/.out/${name}.${r.container}`, Buffer.from(r.b64, 'base64'));
    const { b64, ...info } = r;
    console.log(name, JSON.stringify(info), `${(info.frames / info.seconds).toFixed(1)} fps`);
    verify(`${root}e2e/.out/${name}.${r.container}`, info.frames);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

/** Check the written file with ffprobe/ffmpeg rather than trusting that export did not throw. */
function verify(file, frames) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }));
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  assert.equal(v.width, 1080);
  assert.equal(v.height, 1920);
  assert.equal(Number(v.nb_read_frames), frames, 'frame count');
  assert.ok(a, 'audio stream present');
  const run = (from, len) => {
    const r = execFileSync('sh', ['-c', `ffmpeg -ss ${from} -t ${len} -i '${file}' -vn -af volumedetect -f null - 2>&1`], { encoding: 'utf8' });
    return Number(/mean_volume: (-?[\d.]+) dB/.exec(r)[1]);
  };
  const start = run(0, 0.3), mid = run(2, 0.3), end = run(4.7, 0.3);
  assert.ok(mid - start > 8, `fade in: ${start} -> ${mid} dB`);
  assert.ok(mid - end > 8, `fade out: ${mid} -> ${end} dB`);
  console.log('  verified: 1080x1920, frames, audio, fade in/out');
}
