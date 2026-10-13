// TurboCut desktop shell (Windows, Linux). The app itself is the same web build used everywhere;
// this only opens a window and serves it over a secure, privileged app:// origin so WebCodecs,
// WebGPU, workers and fetch behave exactly as they do on a web host.
const { app, BrowserWindow, protocol, net, shell, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const DIST = path.join(__dirname, '..', 'dist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 760,
    minHeight: 520,
    title: 'TurboCut',
    backgroundColor: '#101014',
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
  // Links that leave the app open in the system browser, never inside the editor window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadURL(process.env.TURBOCUT_DEV_URL || 'app://turbocut/index.html');
  return win;
}

/**
 * Self-update from GitHub Releases (electron-updater). Works for the Windows installer and the Linux AppImage.
 * The portable .exe and the .deb cannot replace themselves; for those the app falls back to the download page.
 */
function setupUpdater(getWindow) {
  let updater = null;
  const unsupported = () => {
    if (!app.isPackaged) return 'This is a development run, not an installed app.';
    if (process.env.PORTABLE_EXECUTABLE_DIR) return 'The portable version cannot update itself. Download the new file instead.';
    if (process.platform === 'linux' && !process.env.APPIMAGE) return 'Only the AppImage updates itself. For the .deb, download the new package.';
    return null;
  };
  const get = () => {
    if (updater) return updater;
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = false;
    updater.allowPrerelease = true; // test builds are published as pre-releases
    updater.autoInstallOnAppQuit = false;
    updater.on('download-progress', (p) => getWindow()?.webContents.send('updater:progress', Math.round(p.percent)));
    return updater;
  };
  ipcMain.handle('updater:check', async () => {
    const reason = unsupported();
    if (reason) return { supported: false, reason };
    try {
      const r = await get().checkForUpdates();
      return { supported: true, version: r?.updateInfo?.version };
    } catch (e) {
      return { supported: false, reason: String(e && e.message ? e.message : e) };
    }
  });
  ipcMain.handle('updater:download', async () => {
    await get().downloadUpdate();
  });
  ipcMain.handle('updater:install', async () => {
    get().quitAndInstall(false, true);
  });
}

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
