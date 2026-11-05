const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Tells the web app it is inside the desktop shell and gives it the self-updater. Nothing else is exposed.
let progressHandler = () => {};
ipcRenderer.on('updater:progress', (_e, percent) => progressHandler(percent));

const listeners = { devices: [], offer: [], received: [], shelf: [], paired: [] };
ipcRenderer.on('share:paired', (_e, list) => listeners.paired.forEach((f) => f(list)));
ipcRenderer.on('share:shelf', (_e, x) => listeners.shelf.forEach((f) => f(x)));
ipcRenderer.on('share:devices', (_e, list) => listeners.devices.forEach((f) => f(list)));
ipcRenderer.on('share:offer', (_e, o) => listeners.offer.forEach((f) => f(o)));
ipcRenderer.on('share:received', (_e, r) => listeners.received.forEach((f) => f(r)));
const convertProgress = new Map();
ipcRenderer.on('transcode:progress', (_e, id, f) => convertProgress.get(id)?.(f));
const twitchProgress = new Map();
ipcRenderer.on('twitch:progress', (_e, id, f) => twitchProgress.get(id)?.(f));

contextBridge.exposeInMainWorld('turbocut', {
  platform: 'electron',
  version: process.versions.electron,
  window: {
    customFrame: ipcRenderer.sendSync('window:info'),
    control: (action) => ipcRenderer.send('window:control', action),
    setCustomFrame: (on) => ipcRenderer.invoke('window:set-frame', on),
    setBackground: (colour) => ipcRenderer.send('window:background', colour),
    onState: (fn) => ipcRenderer.on('window:state', (_e, max) => fn(max)),
  },
  // Saving and opening project files, and the path a picked or dropped file has on disk (empty for a file that is not on disk).
  project: {
    choose: (name) => ipcRenderer.invoke('project:choose', name),
    write: (path, text) => ipcRenderer.invoke('project:write', path, text),
    writeStart: (path) => ipcRenderer.invoke('project:write-start', path),
    writeChunk: (id, bytes) => ipcRenderer.invoke('project:write-chunk', id, bytes),
    writeEnd: (id, commit) => ipcRenderer.invoke('project:write-end', id, commit),
    read: (path) => ipcRenderer.invoke('project:read', path),
    open: () => ipcRenderer.invoke('project:open'),
  },
  media: {
    pathFor: (file) => {
      try {
        return webUtils.getPathForFile(file) || '';
      } catch {
        return '';
      }
    },
    stat: (paths) => ipcRenderer.invoke('media:stat', paths),
  },
  twitch: {
    download: async (slug, id, onProgress, rank = 0) => {
      twitchProgress.set(id, onProgress);
      try {
        return await ipcRenderer.invoke('twitch:download', slug, id, rank);
      } finally {
        twitchProgress.delete(id);
      }
    },
    cancel: (id) => ipcRenderer.send('twitch:cancel', id),
  },
  transcode: {
    available: () => ipcRenderer.invoke('transcode:available'),
    begin: (name) => ipcRenderer.invoke('transcode:begin', name),
    write: (id, bytes) => ipcRenderer.invoke('transcode:write', id, bytes),
    run: async (id, onProgress) => {
      convertProgress.set(id, onProgress);
      try {
        return await ipcRenderer.invoke('transcode:run', id);
      } finally {
        convertProgress.delete(id);
      }
    },
    cancel: (id) => ipcRenderer.send('transcode:cancel', id),
    done: (id) => ipcRenderer.send('transcode:done', id),
  },
  share: {
    configure: (o) => ipcRenderer.invoke('share:configure', o),
    devices: () => ipcRenderer.invoke('share:devices'),
    paired: () => ipcRenderer.invoke('share:paired'),
    forget: (id) => ipcRenderer.send('share:forget', id),
    on: (what, fn) => void listeners[what]?.push(fn),
    answer: (offerId, accept) => ipcRenderer.send('share:answer', offerId, accept),
    offer: (deviceId, summary) => ipcRenderer.invoke('share:send-offer', deviceId, summary),
    partOpen: (transfer, kind, name) => ipcRenderer.invoke('share:part-open', transfer, kind, name),
    partWrite: (transfer, id, bytes) => ipcRenderer.invoke('share:part-write', transfer, id, bytes),
    partEnd: (transfer, id) => ipcRenderer.invoke('share:part-end', transfer, id),
    finish: (transfer) => ipcRenderer.invoke('share:finish', transfer),
    abort: (transfer) => ipcRenderer.send('share:abort', transfer),
    shelfOpen: (summary, pairedId) => ipcRenderer.invoke('share:shelf-open', summary, pairedId),
    shelfReady: (transfer) => ipcRenderer.invoke('share:shelf-ready', transfer),
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
