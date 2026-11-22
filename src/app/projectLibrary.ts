import { FORMATS, FORMAT_EXT, formatOfName, type ProjectFormat } from '../core/projectFile.ts';
import { APP_FOLDER, APP_PREFIX, PERSONAL_FOLDER, androidLoc, baseName, writeRef, type ProjectRef } from './projectFiles.ts';
import { platform } from './platform.ts';

/**
 * The project manager's data: the folders TurboCut keeps projects in and the project files inside them.
 *  - desktop app: the default folder is TurboCut's app-data folder; the person can add personal folders. The shell does the listing
 *    (`electron/projectLibrary.cjs`) and only ever lists the folders it was configured with;
 *  - Android: TurboCut's own storage (default) and Documents/TurboCut (the personal folder, which a computer and other apps can see);
 *  - a browser: the browser's private storage for this site. Save still uses the browser's own save dialog when it has one, so this folder holds what
 *    arrives from another device.
 */
export interface LibFolder {
  /** The path on the desktop, a `data:` path or a Documents path on Android, a fixed name in a browser. */
  path: string;
  label: string;
  kind: 'default' | 'personal';
  /** False for a folder that was added and is gone now (a drive that is not connected). */
  exists: boolean;
}

export interface LibEntry {
  ref: ProjectRef;
  name: string;
  /** Which folder (its `path`). */
  folder: string;
  folderLabel: string;
  format: ProjectFormat;
  size: number;
  /** Milliseconds since 1970, 0 when unknown. */
  modified: number;
}

interface DesktopLib {
  folders(): Promise<{ folders: { path: string; kind: 'default' | 'personal'; exists: boolean }[]; saveIn: string }>;
  list(): Promise<{ path: string; name: string; folder: string; kind: string; size: number; modified: number }[]>;
  addFolder(): Promise<{ folders: { path: string; kind: 'default' | 'personal'; exists: boolean }[]; saveIn: string } | null>;
  removeFolder(dir: string): Promise<unknown>;
  setSaveFolder(dir: string | null): Promise<unknown>;
  reveal(file: string): Promise<void>;
  trash(file: string): Promise<void>;
  rename(file: string, name: string): Promise<string>;
  uniquePath(name: string): Promise<string>;
}
const desktop = (): DesktopLib | undefined => (globalThis as any).turbocut?.project?.folders ? (globalThis as any).turbocut.project : undefined;

const OPFS = 'projects';
const opfsRoot = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const root = await navigator.storage?.getDirectory?.();
    return root ? await root.getDirectoryHandle(OPFS, { create: true }) : null;
  } catch {
    return null;
  }
};

const isProjectName = (n: string) => FORMATS.some((f) => n.toLowerCase().endsWith(FORMAT_EXT[f]));

/** Whether the person can add folders of their own (the desktop app only: a phone and a browser cannot read arbitrary folders). */
export const canAddFolders = (): boolean => !!desktop();
/** Whether a file can be shown in the system's file manager. */
export const canReveal = (): boolean => !!desktop();
/** Whether this device has anywhere to keep projects (an old browser without private storage does not). */
export async function available(): Promise<boolean> {
  return !!desktop() || platform === 'android' || !!(await opfsRoot());
}

export async function folders(): Promise<{ list: LibFolder[]; saveIn: string }> {
  const d = desktop();
  if (d) {
    const r = await d.folders();
    return { list: r.folders.map((f) => ({ ...f, label: f.kind === 'default' ? 'TurboCut (app data)' : baseName(f.path) || f.path })), saveIn: r.saveIn };
  }
  if (platform === 'android') {
    return { list: [{ path: APP_FOLDER, label: 'TurboCut (app storage)', kind: 'default', exists: true }, { path: PERSONAL_FOLDER, label: 'Documents/TurboCut (personal files)', kind: 'personal', exists: true }], saveIn: '' };
  }
  return { list: [{ path: OPFS, label: 'This browser (private storage)', kind: 'default', exists: true }], saveIn: OPFS };
}

/** Every project file in every folder, newest first. */
export async function list(): Promise<LibEntry[]> {
  const d = desktop();
  const out: LibEntry[] = [];
  const { list: dirs } = await folders();
  const label = (p: string) => dirs.find((f) => f.path === p)?.label ?? p;
  if (d) {
    for (const e of await d.list()) out.push({ ref: { kind: 'path', path: e.path }, name: e.name, folder: e.folder, folderLabel: label(e.folder), format: formatOfName(e.name), size: e.size, modified: e.modified });
  } else if (platform === 'android') {
    const { Filesystem } = await import('@capacitor/filesystem');
    for (const f of dirs) {
      try {
        const at = await androidLoc(f.path);
        const r = await Filesystem.readdir({ path: at.path, directory: at.directory });
        for (const file of r.files) {
          if (file.type !== 'file' || !isProjectName(file.name)) continue;
          out.push({ ref: { kind: 'path', path: `${f.path}/${file.name}` }, name: file.name, folder: f.path, folderLabel: f.label, format: formatOfName(file.name), size: file.size, modified: file.mtime ?? 0 });
        }
      } catch {
        /* the folder does not exist yet: nothing in it */
      }
    }
  } else {
    const dir = await opfsRoot();
    if (dir) {
      for await (const [name, h] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
        if (h.kind !== 'file' || !isProjectName(name)) continue;
        const f = await (h as FileSystemFileHandle).getFile();
        out.push({ ref: { kind: 'handle', handle: h as FileSystemFileHandle }, name, folder: OPFS, folderLabel: label(OPFS), format: formatOfName(name), size: f.size, modified: f.lastModified });
      }
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** The folder a new project goes to now (a `path` from `folders()`). */
export async function saveFolder(androidChoice: 'app' | 'personal'): Promise<string> {
  if (desktop()) return (await folders()).saveIn;
  if (platform === 'android') return androidChoice === 'personal' ? PERSONAL_FOLDER : APP_FOLDER;
  return OPFS;
}

/** Choose where new projects go. On the desktop `dir` is one of the listed folders; null is the default. Android keeps its choice in the settings. */
export async function setSaveFolder(dir: string | null): Promise<void> {
  await desktop()?.setSaveFolder(dir);
}

export async function addFolder(): Promise<boolean> {
  const d = desktop();
  return !!d && !!(await d.addFolder());
}

export async function removeFolder(dir: string): Promise<void> {
  await desktop()?.removeFolder(dir);
}

export async function reveal(e: LibEntry): Promise<void> {
  if (e.ref.kind === 'path') await desktop()?.reveal(e.ref.path);
}

/** Delete a project file. The desktop app moves it to the system's bin. A phone and a browser delete it for good (the manager asks first). */
export async function remove(e: LibEntry): Promise<void> {
  const d = desktop();
  if (d && e.ref.kind === 'path') return d.trash(e.ref.path);
  if (e.ref.kind === 'path') {
    const { Filesystem } = await import('@capacitor/filesystem');
    const at = await androidLoc(e.ref.path);
    return void (await Filesystem.deleteFile({ path: at.path, directory: at.directory }));
  }
  const dir = await opfsRoot();
  await dir?.removeEntry(e.name);
}

/** Rename a project file, keeping its extension. Returns the file it is now (its reference changes). */
export async function rename(e: LibEntry, name: string): Promise<ProjectRef> {
  const stem = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\.turbocut[cf]?$/i, '').trim();
  if (!stem) throw new Error('Give it a name.');
  const ext = FORMAT_EXT[e.format];
  const d = desktop();
  if (d && e.ref.kind === 'path') return { kind: 'path', path: await d.rename(e.ref.path, `${stem}${ext}`) };
  if (e.ref.kind === 'path') {
    const { Filesystem } = await import('@capacitor/filesystem');
    const from = await androidLoc(e.ref.path);
    const dir = e.ref.path.slice(0, e.ref.path.lastIndexOf('/'));
    const to = await androidLoc(`${dir}/${stem}${ext}`);
    await Filesystem.stat(to).then(() => { throw new Error(`There is already a project called ${stem}${ext} here.`); }, (err) => { if (err instanceof Error && /already a project/.test(err.message)) throw err; });
    await Filesystem.rename({ from: from.path, to: to.path, directory: from.directory, toDirectory: to.directory });
    return { kind: 'path', path: `${dir}/${stem}${ext}` };
  }
  // A browser's private storage has no rename: write the new file, then remove the old one.
  const dir = await opfsRoot();
  if (!dir) throw new Error('This browser has nowhere to keep projects.');
  const exists = await dir.getFileHandle(`${stem}${ext}`).then(() => true, () => false);
  if (exists) throw new Error(`There is already a project called ${stem}${ext} here.`);
  const handle = await dir.getFileHandle(`${stem}${ext}`, { create: true });
  const w = await handle.createWritable();
  try {
    await w.write(await (await (e.ref as { handle: FileSystemFileHandle }).handle.getFile()).arrayBuffer());
  } finally {
    await w.close();
  }
  await dir.removeEntry(e.name);
  return { kind: 'handle', handle };
}

/**
 * Keep a project file that arrived from another device (a bundle fetched from a computer) in the default folder, under a name that is not taken.
 * Returns the reference to open it from. The desktop app does this in the shell, so this is the phone and the browser.
 */
export async function keepReceived(blob: Blob, name: string, androidChoice: 'app' | 'personal' = 'app'): Promise<ProjectRef> {
  const clean = baseName(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'project.turbocutf';
  const ext = FORMATS.map((f) => FORMAT_EXT[f]).find((x) => clean.toLowerCase().endsWith(x)) ?? FORMAT_EXT.full;
  const stem = clean.toLowerCase().endsWith(ext) ? clean.slice(0, -ext.length) : clean;
  const unique = async (taken: (n: string) => Promise<boolean>) => {
    let n = 1;
    let file = `${stem}${ext}`;
    while (await taken(file)) file = `${stem} ${++n}${ext}`;
    return file;
  };
  const d = desktop();
  if (d) {
    const ref: ProjectRef = { kind: 'path', path: await d.uniquePath(`${stem}${ext}`) };
    await writeRef(ref, blob);
    return ref;
  }
  if (platform === 'android') {
    const { Filesystem } = await import('@capacitor/filesystem');
    const folder = androidChoice === 'personal' ? PERSONAL_FOLDER : APP_FOLDER;
    const at = await androidLoc(folder);
    await Filesystem.mkdir({ path: at.path, directory: at.directory, recursive: true }).catch(() => {});
    const file = await unique(async (n) => androidLoc(`${folder}/${n}`).then((l) => Filesystem.stat(l)).then(() => true, () => false));
    const ref: ProjectRef = { kind: 'path', path: `${folder}/${file}` };
    await writeRef(ref, blob);
    return ref;
  }
  const dir = await opfsRoot();
  if (!dir) throw new Error('This browser has nowhere to keep the project. Use File → Open instead.');
  const file = await unique((n) => dir.getFileHandle(n).then(() => true, () => false));
  const handle = await dir.getFileHandle(file, { create: true });
  const w = await handle.createWritable();
  try {
    await w.write(blob);
  } finally {
    await w.close();
  }
  return { kind: 'handle', handle };
}

export { APP_PREFIX };
