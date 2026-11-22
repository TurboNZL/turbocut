// The desktop side of the project manager: which folders TurboCut keeps projects in, what is in them, and where the file dialogs start.
//
//  - the default folder is TurboCut's own app-data folder (`<userData>/Projects`: %APPDATA%\TurboCut on Windows, ~/.config/TurboCut on Linux);
//  - the person can add personal folders (Documents, a synced folder, ...). They are read, and a new project can be saved in any of them;
//  - the last folder a save or open dialog was used in is remembered, so the dialog does not start in the home directory every time.
//
// The page never names a folder: it asks for the configured ones, and the shell lists only those. The folder list is stored in a small JSON file.
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_FILE = /\.turbocut[cf]?$/i;
const MAX_FOLDERS = 20;
const MAX_ENTRIES = 2000;

const emptyConfig = () => ({ extra: [], saveIn: null, lastDir: null });

const isDir = (d) => {
  try {
    return fs.statSync(d).isDirectory();
  } catch {
    return false;
  }
};

/** A folder path the shell accepts: absolute, no NUL, normalised, no trailing separator (the root stays as it is). */
function cleanDir(p) {
  if (typeof p !== 'string' || !p || p.length > 1024 || p.includes('\0') || !path.isAbsolute(p)) return null;
  const n = path.normalize(p);
  return n.length > 1 ? n.replace(/[\\/]+$/, '') : n;
}

class ProjectLibrary {
  /** `defaultDir` is the app-data folder; `configFile` holds the rest. */
  constructor({ defaultDir, configFile, documents }) {
    this.defaultDir = path.normalize(defaultDir);
    this.configFile = configFile;
    this.documents = documents;
    this.cfg = this.load();
  }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      const extra = Array.isArray(j.extra) ? j.extra.map(cleanDir).filter((d) => d && d !== this.defaultDir) : [];
      return { extra: [...new Set(extra)].slice(0, MAX_FOLDERS), saveIn: cleanDir(j.saveIn), lastDir: cleanDir(j.lastDir) };
    } catch {
      return emptyConfig();
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
      const tmp = `${this.configFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.cfg));
      fs.renameSync(tmp, this.configFile);
    } catch {
      /* a folder list that cannot be saved is lost on exit; nothing else breaks */
    }
  }

  /** The default folder, created when it is needed. */
  ensureDefault() {
    fs.mkdirSync(this.defaultDir, { recursive: true });
    return this.defaultDir;
  }

  /** Every folder projects are read from, the default first. A folder that no longer exists stays listed (the person may reconnect a drive) but is flagged. */
  folders() {
    return [{ path: this.defaultDir, kind: 'default', exists: true }, ...this.cfg.extra.map((p) => ({ path: p, kind: 'personal', exists: isDir(p) }))];
  }

  /** The folder a new project is saved in unless the person picks another place: the chosen one when it is still there, else the default. */
  saveFolder() {
    const s = this.cfg.saveIn;
    return s && (s === this.defaultDir || this.cfg.extra.includes(s)) && isDir(s) ? s : this.ensureDefault();
  }

  /** Where a save or open dialog starts: the last folder used when it still exists, else the folder new projects go to. */
  startDir() {
    const l = this.cfg.lastDir;
    return l && isDir(l) ? l : this.saveFolder();
  }

  /** Remember the folder of a file the person just saved or opened. */
  remember(file) {
    const d = cleanDir(path.dirname(String(file)));
    if (!d || d === this.cfg.lastDir) return;
    this.cfg.lastDir = d;
    this.save();
  }

  addFolder(dir) {
    const d = cleanDir(dir);
    if (!d || !isDir(d)) throw new Error('That folder cannot be used.');
    if (d === this.defaultDir || this.cfg.extra.includes(d)) return this.folders();
    if (this.cfg.extra.length >= MAX_FOLDERS) throw new Error('That is enough folders. Remove one first.');
    this.cfg.extra.push(d);
    this.save();
    return this.folders();
  }

  removeFolder(dir) {
    const d = cleanDir(dir);
    this.cfg.extra = this.cfg.extra.filter((x) => x !== d);
    if (this.cfg.saveIn === d) this.cfg.saveIn = null;
    this.save();
    return this.folders();
  }

  /** Choose where new projects go: a listed folder, or null for the default. */
  setSaveFolder(dir) {
    const d = dir == null ? null : cleanDir(dir);
    if (d && d !== this.defaultDir && !this.cfg.extra.includes(d)) throw new Error('That folder is not one of TurboCut\'s project folders.');
    this.cfg.saveIn = d === this.defaultDir ? null : d;
    this.save();
  }

  /** The project files directly inside the listed folders (not their subfolders), newest first. */
  list() {
    const out = [];
    for (const f of this.folders()) {
      if (!f.exists) continue;
      let names;
      try {
        names = fs.readdirSync(f.path);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!PROJECT_FILE.test(name) || out.length >= MAX_ENTRIES) continue;
        const file = path.join(f.path, name);
        try {
          const st = fs.statSync(file);
          if (st.isFile()) out.push({ path: file, name, folder: f.path, kind: f.kind, size: st.size, modified: st.mtimeMs });
        } catch {
          /* vanished while listing */
        }
      }
    }
    return out.sort((a, b) => b.modified - a.modified);
  }

  /** Whether a path is a project file inside one of the listed folders (the only files the page may rename or delete). */
  owns(file) {
    const f = cleanDir(file);
    return !!f && PROJECT_FILE.test(f) && this.folders().some((d) => path.dirname(f) === d.path);
  }

  /** A name that does not exist yet in the folder: "Name.turbocutf", then "Name 2.turbocutf", ... */
  uniqueName(dir, name) {
    const safe = String(name || 'project.turbocutf').split(/[\\/]/).pop().replace(/[\\/:*?"<>|\0]/g, ' ').trim() || 'project.turbocutf';
    const m = /^(.*?)(\.turbocut[cf]?)?$/i.exec(safe);
    const stem = m[1] || 'project';
    const ext = (m[2] || '.turbocutf').toLowerCase();
    let n = 1;
    let file = `${stem}${ext}`;
    while (fs.existsSync(path.join(dir, file))) file = `${stem} ${++n}${ext}`;
    return file;
  }

  /** Move a file that arrived (a project another device sent) into the folder new projects go to, under a name that is not taken. Returns the new path. */
  importFile(src, name) {
    const dir = this.saveFolder();
    const dest = path.join(dir, this.uniqueName(dir, name));
    try {
      fs.renameSync(src, dest);
    } catch {
      fs.copyFileSync(src, dest); // another disk: a rename cannot cross it
      fs.rmSync(src, { force: true });
    }
    return dest;
  }

  /** Rename a listed project, keeping its extension. Returns the new path. */
  rename(file, newName) {
    if (!this.owns(file)) throw new Error('That file is not in a TurboCut project folder.');
    const ext = path.extname(file);
    const stem = path.basename(String(newName || ''), path.extname(String(newName || ''))).replace(/[\\/:*?"<>|\0]/g, ' ').trim();
    if (!stem) throw new Error('Give it a name.');
    const dest = path.join(path.dirname(file), `${stem}${ext}`);
    if (dest === path.normalize(file)) return dest;
    if (fs.existsSync(dest)) throw new Error(`There is already a project called ${stem}${ext} in that folder.`);
    fs.renameSync(file, dest);
    return dest;
  }
}

module.exports = { ProjectLibrary, PROJECT_FILE, cleanDir };
