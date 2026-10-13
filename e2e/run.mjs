// Runs the real export pipeline in headless Chromium and writes the result to e2e/.out/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}e2e/.out`, { recursive: true });
const server = await createServer({ root, server: { port: 5188, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
try {
  {
    const page = await browser.newPage();
    await page.goto('http://localhost:5188/e2e/index.html');
    await page.waitForFunction(() => typeof window.previewMatchesExport === 'function');
    const diff = await page.evaluate(() => window.previewMatchesExport());
    console.log(`preview vs export mean difference: ${diff.toFixed(2)} / 255`);
    assert.ok(diff < 0.5, `preview must match export, got ${diff}`);
    await page.close();
  }
  {
    const page = await browser.newPage();
    await page.goto('http://localhost:5188/e2e/index.html');
    await page.waitForFunction(() => typeof window.captionHoles === 'function');
    const h = await page.evaluate(() => window.captionHoles());
    console.log('caption counters (enclosed clear pixels):', JSON.stringify(h));
    assert.ok(h.trueCounters > 500, 'the test text has counters to measure');
    assert.ok(h.oldMethod < h.trueCounters * 0.6, `the old centred stroke should be filling counters (${h.oldMethod} of ${h.trueCounters})`);
    assert.ok(h.newMethod > h.trueCounters * 0.9, `counters must stay clear: ${h.newMethod} of ${h.trueCounters}`);
    assert.ok(h.outlinePixels > 2000 && h.fillPixels > 2000, 'outline and fill are both still drawn');
    await page.close();
  }
  {
    const page = await browser.newPage();
    await page.goto('http://localhost:5188/e2e/index.html');
    await page.waitForFunction(() => typeof window.speechAudio === 'function');
    const r = await page.evaluate(() => window.speechAudio());
    const got = new Float32Array(Buffer.from(r.b64, 'base64').buffer.slice(0));
    writeFileSync(`${root}e2e/.out/speech-16k.f32`, Buffer.from(r.b64, 'base64'));
    // Reference: the same edit made by ffmpeg (50 s from 3 s, 2 s of silence, 20 s from 50 s), resampled to 16 kHz mono.
    const ref = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', `${root}e2e/.media/chirp.webm`, '-filter_complex',
      '[0:a]atrim=start=3:end=53,asetpts=PTS-STARTPTS[a];aevalsrc=0:s=48000:d=2[s];[0:a]atrim=start=50:end=70,asetpts=PTS-STARTPTS[b];[a][s][b]concat=n=3:v=0:a=1,aresample=16000,aformat=channel_layouts=mono[o]',
      '-map', '[o]', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
    const want = new Float32Array(ref.buffer.slice(ref.byteOffset, ref.byteOffset + ref.byteLength));
    console.log(`speech audio: ${got.length} samples (${(got.length / 16000).toFixed(2)} s) vs reference ${want.length} (${(want.length / 16000).toFixed(2)} s)`);
    assert.ok(Math.abs(got.length - want.length) < 16000 * 0.05, 'length matches the timeline');
    // Per second: best normalised correlation over a +-8 ms search, the lag it was found at, and the level ratio.
    // A shifted, gapped or repeated stretch of audio shows up as a low correlation or a lag far from the constant
    // ~6 ms the Opus decoder's start delay causes. (The reference is louder by about 3 dB because ffmpeg sums channels
    // when it downmixes where the browser averages them; the ratio must simply stay constant.)
    let worst = 1, worstAt = 0, lagMin = 1e9, lagMax = -1e9, gains = [];
    for (let sec = 1; sec + 1 <= Math.min(got.length, want.length) / 16000 - 1; sec++) {
      let gg = 0, ww = 0;
      for (let i = sec * 16000; i < (sec + 1) * 16000; i++) { gg += got[i] * got[i]; ww += want[i] * want[i]; }
      if (ww < 1) { assert.ok(gg < 1, `second ${sec} must be silent like the reference`); continue; } // the 2 s gap
      let bestC = -2, bestLag = 0;
      for (let lag = -128; lag <= 128; lag++) {
        let gw = 0, w2 = 0;
        for (let i = sec * 16000; i < (sec + 1) * 16000; i++) { const x = want[i + lag]; gw += got[i] * x; w2 += x * x; }
        const c = gw / Math.sqrt(gg * w2 || 1);
        if (c > bestC) ((bestC = c), (bestLag = lag));
      }
      if (bestC < worst) ((worst = bestC), (worstAt = sec));
      lagMin = Math.min(lagMin, bestLag); lagMax = Math.max(lagMax, bestLag);
      gains.push(Math.sqrt(gg / ww));
    }
    const gMin = Math.min(...gains), gMax = Math.max(...gains);
    console.log(`  worst correlation ${worst.toFixed(4)} at ${worstAt}s; lag ${lagMin}..${lagMax} samples; level ratio ${gMin.toFixed(3)}..${gMax.toFixed(3)}`);
    assert.ok(worst > 0.99, `audio fed to Whisper must match the reference (correlation ${worst} at ${worstAt}s)`);
    assert.ok(lagMin >= 80 && lagMax <= 112, `no timing drift: lag must stay near the constant 96 samples, got ${lagMin}..${lagMax}`);
    assert.ok(gMax - gMin < 0.03, 'level must not change from one second to the next');
    await page.close();
  }
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
