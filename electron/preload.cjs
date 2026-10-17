const { contextBridge, ipcRenderer } = require('electron');

// Tells the web app it is inside the desktop shell and gives it the self-updater. Nothing else is exposed.
let progressHandler = () => {};
ipcRenderer.on('updater:progress', (_e, percent) => progressHandler(percent));

contextBridge.exposeInMainWorld('turbocut', {
  platform: 'electron',
  version: process.versions.electron,
  window: {
    customFrame: ipcRenderer.sendSync('window:info'),
    control: (action) => ipcRenderer.send('window:control', action),
    setCustomFrame: (on) => ipcRenderer.invoke('window:set-frame', on),
    onState: (fn) => ipcRenderer.on('window:state', (_e, max) => fn(max)),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onProgress: (fn) => {
      progressHandler = fn;
    },
  },
});
