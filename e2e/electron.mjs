// Runs the built app inside the real Electron shell: protocol, secure context, codecs, import and export.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  // The window is drawn by the theme (frameless) and its controls work.
  const fr = await win.evaluate(() => ({ custom: window.turbocut.window.customFrame, bar: !!document.querySelector('.bt-wf'), btns: document.querySelectorAll('.bt-wf-btn').length, h: document.querySelector('.bt-wf')?.getBoundingClientRect().height, appTop: document.getElementById('app').getBoundingClientRect().top }));
  console.log('window frame:', JSON.stringify(fr));
  assert.equal(fr.custom && fr.bar && fr.btns === 3, true, 'the drawn title bar is present with three buttons');
  assert.equal(fr.appTop >= fr.h - 1, true, 'the editor sits below the title bar');

  // The shell also offers Twitch downloads and finding other TurboCut apps; the page must not be able to reach anything else.
  const api = await win.evaluate(() => ({ twitch: typeof window.turbocut.twitch?.download, share: Object.keys(window.turbocut.share ?? {}).sort().join(), top: Object.keys(window.turbocut).sort().join() }));
  console.log('shell api:', JSON.stringify(api));
  assert.equal(api.twitch, 'function');
  assert.match(api.share, /configure/);
  assert.equal(api.top, 'media,platform,project,share,transcode,twitch,updater,version,window', 'only the documented bridges are exposed');
  // The window was shown only once it had painted: nothing white at the edges (the window background and the page agree).
  const edge = await win.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor }));
  assert.notEqual(edge.html, 'rgba(0, 0, 0, 0)', 'the page paints its own background');
  // With the drawn title bar the home page and everything else start under it.
  // the real app opens on the home screen: pick a shape to get to the editor, then use the dock
  if (await win.locator('.home').count()) await win.locator('.home-start').first().click();
  await win.locator('.home').waitFor({ state: 'detached' });
  await win.evaluate(() => window.turbocutApp.store.updateSettings({ dock: true }));
  await win.locator('.dock .bt-tab', { hasText: 'Home' }).click();
  await win.locator('.home.docked').waitFor();
  const homeTop = await win.evaluate(() => [document.querySelector('.home').getBoundingClientRect().top, document.querySelector('.bt-wf').getBoundingClientRect().bottom]);
  assert.ok(homeTop[0] >= homeTop[1] - 0.5, `the home page starts under the title bar (${homeTop})`);
  await win.locator('.dock .bt-tab', { hasText: 'Edit' }).click();
  await win.evaluate(() => window.turbocutApp.store.updateSettings({ dock: false }));

  // The desktop shell exposes the self-updater. An unpackaged run cannot update, and must say so instead of throwing.
  const upd = await win.evaluate(() => window.turbocut.updater.check());
  console.log('updater in an unpackaged run:', JSON.stringify(upd));
  assert.equal(upd.supported, false);
  assert.match(upd.reason, /development run/i);

  // The desktop app lists the fonts installed on this computer by itself (Chromium's Local Font Access API, no prompt in Electron).
  const sys = await win.evaluate(async () => { const d = await window.turbocutApp.detectSystemFonts(); return { source: d.source, n: d.fonts.length, sample: d.fonts.slice(0, 3).map((f) => f.family) }; });
  console.log('installed fonts:', JSON.stringify(sys));
  assert.equal(sys.source, 'local-fonts', 'Electron answers queryLocalFonts');
  assert.ok(sys.n > 0, 'and returns fonts');

  // HEVC: Electron has no software decoder for it, so without a graphics driver the picture cannot be shown. The shell converts it with ffmpeg
  // and the page opens the copy; the bin item keeps the original's name and size, so a saved project still matches the original file.
  if (existsSync(`${root}e2e/.media/hevc.mp4`)) {
    const hevc = readFileSync(`${root}e2e/.media/hevc.mp4`);
    const r = await win.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const supported = await VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L93.B0' }).then((x) => !!x.supported).catch(() => false);
      const failed = await window.turbocutApp.actions.importOne(new File([bytes], 'hevc.mp4', { type: 'video/mp4' }));
      const a = Object.values(window.turbocutApp.store.project.assets).find((x) => x.name === 'hevc.mp4');
      const opened = a ? window.turbocutApp.store.lib.fileFor(a.id) : null;
      const frame = a ? !!(await window.turbocutApp.store.lib.thumbnail(a.id)) : false;
      return { supported, failed, size: a?.size, openedSize: opened?.size, width: a?.width, frame };
    }, hevc.toString('base64'));
    console.log('hevc import:', JSON.stringify(r));
    assert.equal(r.failed, null, 'the HEVC file imports');
    assert.equal(r.size, hevc.length, 'the asset remembers the original size');
    assert.equal(r.width, 640);
    assert.equal(r.frame, true, 'and it shows a picture');
    if (!r.supported) assert.notEqual(r.openedSize, hevc.length, 'this shell cannot decode HEVC, so a converted copy was opened');
    await win.evaluate(() => window.turbocutApp.store.edit((p) => { for (const a of Object.values(p.assets)) delete p.assets[a.id]; }));
  }

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
  assert.equal(Number(v.nb_read_frames), 360, "6 s at the 60 fps default");
  assert.ok(a, 'audio stream present');
  if (env.h264) assert.deepEqual([v.codec_name, a.codec_name, info.container], ['h264', 'aac', 'mp4'], 'H.264 + AAC in MP4 when the shell can encode H.264');

  // ---- project files and media paths, through the real shell: a save dialog (answered by the test), the file on disk, a reopen that finds the
  // video again by its remembered path, and the message when the file has moved.
  {
    const dir = mkdtempSync(join(tmpdir(), 'tcfiles-'));
    const clip = join(dir, 'pathclip.webm');
    copyFileSync(`${root}e2e/.media/src.webm`, clip);
    const projectFile = join(dir, 'Shell short.turbocut');
    await app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, projectFile);
    const menu = async (name) => { await win.getByRole('button', { name: 'File', exact: true }).click(); await win.getByRole('menuitem', { name }).click(); };
    await menu('New project');
    await win.getByRole('button', { name: 'Discard it' }).click();
    const [chooser] = await Promise.all([win.waitForEvent('filechooser'), menu('Import media…')]);
    await chooser.setFiles(clip);
    await win.waitForFunction(() => Object.keys(window.turbocutApp.store.project.assets).length === 1, null, { timeout: 20000 });
    const imported = await win.evaluate(() => Object.values(window.turbocutApp.store.project.assets)[0]);
    console.log('imported asset path:', imported.path);
    assert.equal(imported.path, clip, 'the shell told the page where the picked file is');
    await win.evaluate(() => { const a = window.turbocutApp; a.actions.addAsset(Object.keys(a.store.project.assets)[0]); a.store.edit((p) => (p.name = 'Shell short')); });
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !window.turbocutApp.store.dirty);
    const saved = readFileSync(projectFile, 'utf8');
    assert.ok(saved.includes(JSON.stringify(clip).slice(1, -1)), 'the project file remembers the video\'s path');
    assert.ok(!saved.includes('AAAA') && saved.length < 20000, 'and holds the edit, not the video');
    await win.evaluate(() => window.turbocutApp.store.edit((p) => (p.name = 'Shell short 2'))); // autosave writes it after a few seconds
    await win.waitForFunction(() => !window.turbocutApp.store.dirty, null, { timeout: 15000 });
    assert.match(readFileSync(projectFile, 'utf8'), /Shell short 2/, 'autosave wrote to the same file');

    // reopen: nothing is asked, the video is back and shows a picture
    await menu('New project');
    await menu('Open project…');
    await win.waitForFunction(() => window.turbocutApp.store.project.name === 'Shell short 2');
    await win.waitForFunction(() => window.turbocutApp.store.missingAssets().length === 0 && /^Opened /.test(window.turbocutApp.store.status), null, { timeout: 20000 }); // the media is open the moment it is listed, its first picture is checked a moment later
    assert.equal(await win.getByRole('dialog', { name: 'Find the media' }).count(), 0, 'nothing to find: the path was enough');
    assert.equal(await win.evaluate(async () => { const a = window.turbocutApp; return !!(await a.store.lib.thumbnail(Object.keys(a.store.project.assets)[0])); }), true, 'and it plays');
    // a full project: saved as .turbocutf through the real dialog and written to disk in pieces, then opened with the video gone from where it was
    const full = join(dir, 'Shell full.turbocutf');
    await app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, full);
    await win.evaluate(() => window.turbocutApp.actions.saveProject(true));
    await win.waitForFunction(() => /Saved Shell full\.turbocutf/.test(window.turbocutApp.store.status), null, { timeout: 20000 });
    assert.equal(readFileSync(full).subarray(0, 18).toString(), 'TURBOCUT-BUNDLE-1\n', 'the shell wrote a bundle');
    assert.ok(statSync(full).size > statSync(clip).size, 'with the video inside');
    assert.equal(await win.locator('.proj-label').textContent(), 'Shell full.turbocutf', 'the header names the file');
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no temporary file is left behind');
    renameSync(clip, join(dir, 'gone.webm'));
    await menu('New project');
    await win.getByRole('button', { name: 'Discard it' }).click({ timeout: 2000 }).catch(() => {});
    await menu('Open project…');
    await win.waitForFunction(() => window.turbocutApp.store.project.name === 'Shell short 2' && /^Opened Shell full\.turbocutf/.test(window.turbocutApp.store.status), null, { timeout: 30000 });
    assert.equal(await win.evaluate(() => window.turbocutApp.store.missingAssets().length), 0, 'the video came out of the bundle, not from its old path');
    assert.equal(await win.evaluate(async () => { const a = window.turbocutApp; return !!(await a.store.lib.thumbnail(Object.keys(a.store.project.assets)[0])); }), true, 'and plays');
    renameSync(join(dir, 'gone.webm'), clip);
    await app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, projectFile);
    // the file moves: the project opens and says what is missing
    renameSync(clip, join(dir, 'moved.webm'));
    await menu('Open project…');
    await win.getByRole('dialog', { name: 'Find the media' }).waitFor();
    assert.match(await win.locator('.relink-list').textContent(), /pathclip\.webm/);
    await win.keyboard.press('Escape');
    await win.getByRole('dialog', { name: 'Find the media' }).waitFor({ state: 'detached' });
    console.log('shell project files ok');
  }
  assert.deepEqual(errors, []);
  console.log('electron e2e passed');
} finally {
  await app.close();
}
