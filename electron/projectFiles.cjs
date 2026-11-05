// Project files and media paths for the desktop app. The page is sandboxed and cannot touch the disk, so the shell does the saving and opening
// of `.turbocut` files (with the system's own dialogs) and serves media from the paths a saved project remembers.
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_EXT = /\.(turbocut[cf]?|json)$/i;
// A bundle (.turbocutf, .turbocutc) holds the videos too: it is never read as text, the page fetches it in pieces.
const BUNDLE_EXT = /\.turbocut[cf]$/i;
const MEDIA_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|mpg|mpeg|ts|3gp|ogv|mp3|m4a|aac|wav|flac|ogg|opus)$/i;
const MAX_PROJECT_BYTES = 64 * 1024 * 1024;

/** A path the page may ask us to read or write as a project: absolute, no NUL, a project extension. Returns the normalised path or throws a sentence. */
function projectPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024 || p.includes('\0') || !path.isAbsolute(p)) throw new Error('That is not a usable file path.');
  if (!PROJECT_EXT.test(p)) throw new Error('A project file ends in .turbocut, .turbocutc or .turbocutf.');
  return path.normalize(p);
}

/** A media path the page may have served: absolute, a media extension, an existing regular file. Returns the normalised path or null. */
function mediaPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024 || p.includes('\0') || !path.isAbsolute(p) || !MEDIA_EXT.test(p)) return null;
  const f = path.normalize(p);
  try {
    return fs.statSync(f).isFile() ? f : null;
  } catch {
    return null;
  }
}

/** A bundle path the page may have served: absolute, a bundle extension, an existing regular file. Returns the normalised path or null. */
function bundlePath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024 || p.includes('\0') || !path.isAbsolute(p) || !BUNDLE_EXT.test(p)) return null;
  const f = path.normalize(p);
  try {
    return fs.statSync(f).isFile() ? f : null;
  } catch {
    return null;
  }
}

/**
 * A file written in pieces (a bundle can be many gigabytes): the pieces go to a temporary file beside the target, and the target is only
 * replaced when the last piece is in, so a crash or a cancel never leaves a half-written project.
 */
class Writers {
  constructor() {
    this.open = new Map();
    this.n = 0;
  }
  start(file) {
    if (this.open.size >= 4) throw new Error('Too many files are being saved at once.');
    const tmp = `${file}.${process.pid}.${this.n}.tmp`;
    const id = String(++this.n);
    this.open.set(id, { file, tmp, fd: fs.openSync(tmp, 'w') });
    return id;
  }
  chunk(id, bytes) {
    const w = this.open.get(id);
    if (!w) throw new Error('That save is over.');
    const b = Buffer.from(bytes.buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes);
    let at = 0;
    while (at < b.length) at += fs.writeSync(w.fd, b, at, b.length - at);
  }
  end(id, commit) {
    const w = this.open.get(id);
    if (!w) return;
    this.open.delete(id);
    try {
      fs.closeSync(w.fd);
      if (commit) fs.renameSync(w.tmp, w.file);
      else fs.rmSync(w.tmp, { force: true });
    } catch (e) {
      fs.rmSync(w.tmp, { force: true });
      throw e;
    }
  }
}

/** Write to a temporary file in the same folder, then rename it over the target: a crash halfway never leaves a half-written project. */
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function readProject(file) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_PROJECT_BYTES) throw new Error('That file is not a project TurboCut can open.');
  return fs.readFileSync(file, 'utf8');
}

/** Register the IPC handlers. `dialog` is Electron's, `win` returns the window to attach dialogs to, `documents` is the folder the dialogs start in. */
function setupProjectFiles({ ipcMain, dialog, win, documents }) {
  // The full project comes first: it is what a plain Save makes. The file type picked in the dialog is the extension of the name.
  const filters = [
    { name: 'TurboCut full project (edit, videos, fonts, style)', extensions: ['turbocutf'] },
    { name: 'TurboCut project (edit only)', extensions: ['turbocut'] },
    { name: 'TurboCut project with its clips', extensions: ['turbocutc'] },
  ];
  const writers = new Writers();
  // Only the place is chosen here; the page then writes (text, or a bundle in pieces) once it knows the format.
  ipcMain.handle('project:choose', async (_e, defaultName) => {
    const name = path.basename(String(defaultName || 'project.turbocutf')).replace(/[\\/:*?"<>|\0]/g, ' ');
    const r = await dialog.showSaveDialog(win(), { title: 'Save project', defaultPath: path.join(documents(), name), filters });
    if (r.canceled || !r.filePath) return null;
    return { path: projectPath(/\.(turbocut[cf]?|json)$/i.test(r.filePath) ? r.filePath : `${r.filePath}.turbocutf`) };
  });
  ipcMain.handle('project:write', (_e, file, text) => {
    if (typeof text !== 'string') throw new Error('Nothing to save.');
    writeAtomic(projectPath(file), text);
  });
  ipcMain.handle('project:write-start', (_e, file) => writers.start(projectPath(file)));
  ipcMain.handle('project:write-chunk', (_e, id, bytes) => writers.chunk(id, bytes));
  ipcMain.handle('project:write-end', (_e, id, commit) => writers.end(id, commit === true));
  ipcMain.handle('project:read', (_e, file) => ({ text: readProject(projectPath(file)) }));
  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(win(), { title: 'Open project', defaultPath: documents(), properties: ['openFile'], filters: [{ name: 'TurboCut projects', extensions: ['turbocutf', 'turbocut', 'turbocutc', 'json'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = projectPath(r.filePaths[0]);
    return { path: file, text: BUNDLE_EXT.test(file) ? null : readProject(file) };
  });
  // Which of these remembered media paths still hold a file (and how big): the page uses it to know what it can open again by itself.
  ipcMain.handle('media:stat', (_e, list) => {
    const out = {};
    for (const p of Array.isArray(list) ? list.slice(0, 500) : []) {
      const f = mediaPath(p);
      if (f) out[p] = fs.statSync(f).size;
    }
    return out;
  });
}

module.exports = { setupProjectFiles, projectPath, mediaPath, bundlePath, writeAtomic, readProject, Writers, MEDIA_EXT };
