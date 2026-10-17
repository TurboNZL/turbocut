// TurboCut desktop shell (Windows, Linux). The app itself is the same web build used everywhere;
// this only opens a window and serves it over a secure, privileged app:// origin so WebCodecs,
// WebGPU, workers and fetch behave exactly as they do on a web host.
const { app, BrowserWindow, protocol, net, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setupUpdater } = require('./updater.cjs');
const { loadFrame, saveFrame } = require('./frameConfig.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

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
ipcMain.on('window:control', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === 'minimize') w.minimize();
  else if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
  else if (action === 'close') w.close();
});
ipcMain.handle('window:set-frame', async (_e, on) => {
  saveFrame(app.getPath('userData'), on === true);
  const r = await dialog.showMessageBox({ type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, message: 'Window style changed', detail: 'The new window style applies after TurboCut restarts.' });
  if (r.response === 0) {
    app.relaunch();
    app.quit();
  }
});

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
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
