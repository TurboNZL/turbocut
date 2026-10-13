const { contextBridge } = require('electron');
// Tells the web app it is running inside the desktop shell. Nothing else is exposed.
contextBridge.exposeInMainWorld('turbocut', { platform: 'electron', version: process.versions.electron });
