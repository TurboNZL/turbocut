// TurboCut desktop shell (Windows, Linux). The app itself is the same web build used everywhere;
// this only opens a window and serves it over a secure, privileged app:// origin so WebCodecs,
// WebGPU, workers and fetch behave exactly as they do on a web host.
const { app, BrowserWindow, protocol, net, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setupUpdater } = require('./updater.cjs');
const { loadFrame, saveFrame } = require('./frameConfig.cjs');
const { downloadClip } = require('./twitch.cjs');
const { Share } = require('./share.cjs');
const { Transcoder, defaultDir } = require('./transcode.cjs');
const os = require('node:os');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// HEVC (H.265) and the other codecs Chromium leaves to the graphics driver: on Linux that is VA-API, which Chromium only uses when asked
// (and, for AMD and some Intel drivers, only when told to skip its driver allow-list). Names Chromium does not know are ignored, so the
// list can carry the spellings of several versions. `TURBOCUT_NO_VAAPI=1` turns it off for a driver that misbehaves. Without a driver
// the page converts the file with ffmpeg instead (transcode.cjs).
if (process.platform === 'linux' && process.env.TURBOCUT_NO_VAAPI !== '1') {
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiIgnoreDriverChecks,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,PlatformHEVCDecoderSupport');
}

const DIST = path.join(__dirname, '..', 'dist');

function createWindow() {
  const customFrame = loadFrame(app.getPath('userData'));
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 760,
    minHeight: 520,
    title: 'TurboCut',
    backgroundColor: '#101014',
    show: false, // shown once the first frame is painted: no white window while the page loads
    frame: !customFrame,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep exports running when the window is covered
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => win.isVisible() || win.show()); // a page that never reports ready-to-show must not leave an invisible window
  win.on('maximize', () => win.webContents.send('window:state', true));
  win.on('unmaximize', () => win.webContents.send('window:state', false));
  // Links that leave the app open in the system browser, never inside the editor window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadURL(process.env.TURBOCUT_DEV_URL || 'app://turbocut/index.html');
  return win;
}

ipcMain.on('window:info', (e) => {
  e.returnValue = loadFrame(app.getPath('userData'));
});
// The window's own colour (what shows behind the page) follows the look, so a window that is not maximised never shows a dark bar.
ipcMain.on('window:background', (e, colour) => {
  if (typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour)) BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(colour);
});
ipcMain.on('window:control', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === 'minimize') w.minimize();
  else if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
  else if (action === 'close') w.close();
});
// Twitch clips: the page cannot fetch them (CORS), the main process can.
const twitchJobs = new Map();
ipcMain.handle('twitch:download', async (e, slug, id, rank) => {
  const ctrl = new AbortController();
  twitchJobs.set(id, ctrl);
  try {
    const { clip, name, bytes } = await downloadClip(String(slug), { rank: Number.isInteger(rank) && rank > 0 ? rank : 0, signal: ctrl.signal, onProgress: (f) => e.sender.send('twitch:progress', id, f ?? null) });
    return { ok: true, name, bytes, clip };
  } catch (err) {
    return { ok: false, cancelled: ctrl.signal.aborted, message: err instanceof Error ? err.message : String(err) };
  } finally {
    twitchJobs.delete(id);
  }
});
ipcMain.on('twitch:cancel', (_e, id) => twitchJobs.get(id)?.abort());
ipcMain.handle('window:set-frame', async (_e, on) => {
  saveFrame(app.getPath('userData'), on === true);
  const r = await dialog.showMessageBox({ type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, message: 'Window style changed', detail: 'The new window style applies after TurboCut restarts.' });
  if (r.response === 0) {
    app.relaunch();
    app.quit();
  }
});

// ---------------------------------------------------------------- finding other TurboCut apps and sending projects to them
let share = null;
const toPage = (channel, ...args) => BrowserWindow.getAllWindows()[0]?.webContents.send(channel, ...args);
function configureShare({ enabled, name }) {
  const label = String(name || '').trim().slice(0, 60) || os.hostname();
  if (!enabled) {
    share?.stop();
    share = null;
    return Promise.resolve({ running: false });
  }
  if (share) {
    share.name = label;
    return Promise.resolve({ running: true, id: share.id, name: label });
  }
  share = new Share({ dir: path.join(app.getPath('userData'), 'received'), name: label, version: app.getVersion() });
  share.on('devices', (list) => toPage('share:devices', list));
  share.on('offer', (o) => toPage('share:offer', o));
  share.on('shelf', (e) => toPage('share:shelf', e));
  share.on('received', (r) =>
    toPage('share:received', {
      from: r.from,
      project: r.project,
      preset: r.preset,
      media: r.media.map((m) => ({ name: m.name, url: `app://turbocut/received/${encodeURIComponent(r.transfer)}/${encodeURIComponent(m.file)}` })),
      fonts: r.fonts.map((m) => ({ name: m.name, url: `app://turbocut/received/${encodeURIComponent(r.transfer)}/${encodeURIComponent(m.file)}` })),
    }),
  );
  return share.start().then(
    () => ({ running: true, id: share.id, name: label }),
    (e) => {
      share = null;
      return { running: false, error: e instanceof Error ? e.message : String(e) };
    },
  );
}
ipcMain.handle('share:configure', (_e, o) => configureShare(o || {}));
ipcMain.handle('share:devices', () => share?.devices() ?? []);
ipcMain.on('share:answer', (_e, offerId, accept) => share?.answer(offerId, accept));
const sendJobs = new Map(); // transfer id -> { dev, parts }
let partCounter = 0;
ipcMain.handle('share:send-offer', async (_e, deviceId, summary) => {
  if (!share) return { ok: false, message: 'Sharing is turned off on this device.' };
  try {
    const { dev, transfer } = await share.offer(deviceId, summary);
    sendJobs.set(transfer, { dev, parts: new Map() });
    return { ok: true, transfer };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle('share:part-open', (_e, transfer, kind, name) => {
  const job = sendJobs.get(transfer);
  if (!share || !job) return { ok: false, message: 'That transfer is over.' };
  const id = `p${++partCounter}`;
  try {
    job.parts.set(id, job.shelf ? share.shelfPart(job.shelf, kind, String(name)) : share.openPart(job.dev, transfer, kind, String(name)));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, id };
});
ipcMain.handle('share:part-write', async (_e, transfer, id, bytes) => {
  const part = sendJobs.get(transfer)?.parts.get(id);
  if (!part) return { ok: false, message: 'That transfer is over.' };
  try {
    await part.write(Buffer.from(bytes.buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle('share:part-end', async (_e, transfer, id) => {
  const job = sendJobs.get(transfer);
  const part = job?.parts.get(id);
  if (!part) return { ok: false, message: 'That transfer is over.' };
  try {
    await part.end();
    job.parts.delete(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle('share:finish', async (_e, transfer) => {
  const job = sendJobs.get(transfer);
  if (!share || !job) return { ok: false, message: 'That transfer is over.' };
  try {
    await share.finish(job.dev, transfer);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    sendJobs.delete(transfer);
  }
});
ipcMain.on('share:abort', (_e, transfer) => {
  const job = sendJobs.get(transfer);
  for (const p of job?.parts.values() ?? []) p.abort();
  if (job?.shelf) share?.shelfClose(job.shelf);
  sendJobs.delete(transfer);
});
// A shelf is a send that waits to be fetched: the parts go in the same way (share:part-*), then the code is shown.
ipcMain.handle('share:shelf-open', (_e, summary) => {
  if (!share) return { ok: false, message: 'Sharing is turned off on this device (Settings, Device).' };
  const { id } = share.shelfOpen({ project: String(summary?.project || 'Untitled').slice(0, 80), media: Number(summary?.media) | 0, fonts: Number(summary?.fonts) | 0, links: Number(summary?.links) | 0, bytes: Number(summary?.bytes) || 0 });
  sendJobs.set(id, { shelf: id, parts: new Map() });
  return { ok: true, transfer: id };
});
ipcMain.handle('share:shelf-ready', (_e, transfer) => {
  if (!share || !sendJobs.get(transfer)?.shelf) return { ok: false, message: 'That shelf is closed.' };
  try {
    return { ok: true, ...share.shelfReady(transfer) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
});
app.on('before-quit', () => share?.stop());

// ---------------------------------------------------------------- converting video this computer cannot decode
const transcoder = new Transcoder({ dir: defaultDir() });
transcoder.sweep();
app.on('before-quit', () => transcoder.sweep());
ipcMain.handle('transcode:available', () => transcoder.available());
ipcMain.handle('transcode:begin', (_e, name) => transcoder.begin(name));
ipcMain.handle('transcode:write', async (_e, id, bytes) => {
  try {
    await transcoder.write(id, Buffer.from(bytes.buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle('transcode:run', async (e, id) => {
  try {
    const r = await transcoder.run(id, (f) => e.sender.send('transcode:progress', id, f));
    return { ok: true, name: r.name, url: `app://turbocut/converted/${r.rel.split('/').map(encodeURIComponent).join('/')}` };
  } catch (err) {
    transcoder.finish(id);
    return { ok: false, cancelled: err?.cancelled === true, message: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.on('transcode:cancel', (_e, id) => transcoder.cancel(id));
ipcMain.on('transcode:done', (_e, id) => transcoder.finish(id));

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    // Copies ffmpeg made of video this computer cannot decode: /converted/<job>/out.mp4, from its own folder and nowhere else.
    if (rel.startsWith('/converted/')) {
      const root = transcoder.dir + path.sep;
      const f = path.normalize(path.join(transcoder.dir, rel.slice('/converted/'.length)));
      if (!f.startsWith(root)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(f).toString());
    }
    // Projects another TurboCut sent: /received/<transfer>/<file>, served from the folder they were stored in and nowhere else.
    if (rel.startsWith('/received/') && share) {
      const root = share.dir + path.sep;
      const f = path.normalize(path.join(share.dir, rel.slice('/received/'.length)));
      if (!f.startsWith(root)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(f).toString());
    }
    const file = path.normalize(path.join(DIST, rel));
    // Refuse anything that escapes the build folder.
    if (!file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  let mainWindow = null;
  setupUpdater(() => BrowserWindow.getAllWindows()[0] ?? mainWindow);
  mainWindow = createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
