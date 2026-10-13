// Runs the built app inside the real Electron shell: protocol, secure context, codecs, import and export.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}e2e/.out`, { recursive: true });
const app = await electron.launch({ args: ['--no-sandbox', root], cwd: root });
try {
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForFunction(() => window.turbocutApp, null, { timeout: 30000 });
  const env = await win.evaluate(async () => {
    const enc = async (codec) => { try { return (await VideoEncoder.isConfigSupported({ codec, width: 1080, height: 1920, bitrate: 8e6, framerate: 30 })).supported; } catch { return false; } };
    const aac = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }).then((r) => r.supported).catch(() => false);
    return { url: location.href, secure: isSecureContext, platform: window.turbocut?.platform, h264: await enc('avc1.640028'), vp9: await enc('vp09.00.10.08'), aac, gpu: !!navigator.gpu, ua: navigator.userAgent.match(/Electron\/[\d.]+|Chrome\/[\d.]+/g)?.join(' ') };
  });
  console.log('electron env:', JSON.stringify(env));
  assert.equal(env.url.startsWith('app://turbocut/'), true, 'served from app://');
  assert.equal(env.secure, true, 'app:// is a secure context');
  assert.equal(env.platform, 'electron', 'preload told the app it is in Electron');

  // The desktop shell exposes the self-updater. An unpackaged run cannot update, and must say so instead of throwing.
  const upd = await win.evaluate(() => window.turbocut.updater.check());
  console.log('updater in an unpackaged run:', JSON.stringify(upd));
  assert.equal(upd.supported, false);
  assert.match(upd.reason, /development run/i);

  // Import through the app and export through the app. In Electron the download goes through the shell.
  const media = readFileSync(`${root}e2e/.media/src.webm`).toString('base64');
  await win.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.turbocutApp.importMedia([new File([bytes], 'clip.webm', { type: 'video/webm' })]);
  }, media);
  const clips = await win.evaluate(() => window.turbocutApp.store.project.tracks.flatMap((t) => t.clips.length));
  assert.deepEqual(clips, [1, 1]);
  // Same export call the Export button makes, but returning facts instead of opening a save dialog.
  const info = await win.evaluate(() => window.turbocutApp.exportForTest());
  const { b64, ...facts } = info;
  console.log('electron export:', JSON.stringify(facts));
  const file = `${root}e2e/.out/electron-export.${info.container}`;
  writeFileSync(file, Buffer.from(b64, 'base64'));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }));
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  console.log('ffprobe:', v.codec_name, `${v.width}x${v.height}`, v.nb_read_frames, 'frames +', a?.codec_name);
  assert.equal(`${v.width}x${v.height}`, '1080x1920');
  assert.equal(Number(v.nb_read_frames), 180);
  assert.ok(a, 'audio stream present');
  if (env.h264) assert.deepEqual([v.codec_name, a.codec_name, info.container], ['h264', 'aac', 'mp4'], 'H.264 + AAC in MP4 when the shell can encode H.264');
  assert.deepEqual(errors, []);
  console.log('electron e2e passed');
} finally {
  await app.close();
}
