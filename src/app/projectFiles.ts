import { Capacitor } from '@capacitor/core';
import { FORMATS, FORMAT_EXT, formatOfName, projectFileName, type ProjectFormat } from '../core/projectFile.ts';
import { isBundle } from '../core/bundle.ts';
import { pickFiles, platform, saveFile } from './platform.ts';

/**
 * Where a project lives. A project is a file the person chose a place for (`.turbocutf` full, `.turbocut` edit only, `.turbocutc` edit with its
 * clips); TurboCut keeps a reference to that file (never a copy of the edit in its own storage), so Save writes back to it and the recent list
 * opens it from there.
 *  - desktop app: a path on the computer (a real save dialog; the shell does the reading and writing);
 *  - a browser with the File System Access API: a file handle (the browser asks again for permission now and then);
 *  - Android: a file under Documents/TurboCut;
 *  - any other browser: no reference is possible, so Save downloads a copy each time.
 * Which format a file is follows its extension, so the save dialog's file type list is how the person picks one.
 */
export type ProjectRef = { kind: 'path'; path: string } | { kind: 'handle'; handle: FileSystemFileHandle };

/** What is written: a project as text, or a bundle (a Blob that may be gigabytes and is streamed, never turned into one string). */
export type Content = string | Blob;

export interface OpenedProject {
  name: string;
  ref: ProjectRef | null;
  /** The project as text (a plain `.turbocut`), or null for a bundle. */
  text: string | null;
  /** The whole bundle (`.turbocutf`, `.turbocutc`), or null for a plain project. */
  bundle: Blob | null;
}

/** Where a save goes, chosen before anything is gathered, because the format decides what is gathered. */
export interface Target {
  ref: ProjectRef | null;
  name: string;
  format: ProjectFormat;
}

interface DesktopApi {
  choose(defaultName: string): Promise<{ path: string } | null>;
  write(path: string, text: string): Promise<void>;
  writeStart(path: string): Promise<string>;
  writeChunk(id: string, bytes: Uint8Array): Promise<void>;
  writeEnd(id: string, commit: boolean): Promise<void>;
  read(path: string): Promise<{ text: string }>;
  open(): Promise<{ path: string; text: string | null } | null>;
}

const desktop = (): DesktopApi | undefined => (globalThis as any).turbocut?.project;
const FOLDER = 'TurboCut';
const DESCRIPTION: Record<ProjectFormat, string> = { full: 'TurboCut full project (edit, videos, fonts, style)', edit: 'TurboCut project (edit only)', clips: 'TurboCut project with its clips' };
const SAVE_TYPES = FORMATS.map((f) => ({ description: DESCRIPTION[f], accept: { [`application/x-turbocut-${f}`]: [FORMAT_EXT[f]] } }));
const OPEN_TYPES = [{ description: 'TurboCut project', accept: { 'application/octet-stream': FORMATS.map((f) => FORMAT_EXT[f]) } }];
export const OPEN_ACCEPT = `${FORMATS.map((f) => FORMAT_EXT[f]).join(',')},.json,application/json`;
const CHUNK = 3 * 1024 * 1024; // a multiple of 3, so every chunk but the last is base64 without padding

/** The last part of a path, whichever separator it uses. */
export const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

export const refName = (ref: ProjectRef): string => (ref.kind === 'handle' ? ref.handle.name : baseName(ref.path));

/** A short line for the recent list: where the file is. Browsers do not reveal folders, so a handle shows its file name only. */
export const refWhere = (ref: ProjectRef): string => (ref.kind === 'handle' ? ref.handle.name : platform === 'android' ? `Documents/${ref.path}` : ref.path);

const fsa = (): { save?: (o: object) => Promise<FileSystemFileHandle>; open?: (o: object) => Promise<FileSystemFileHandle[]> } => ({
  save: (window as any).showSaveFilePicker?.bind(window),
  open: (window as any).showOpenFilePicker?.bind(window),
});

/** Whether Save can write back to the same place next time. False in browsers without file handles: they download a copy instead. */
export const canKeepFile = (): boolean => !!desktop() || platform === 'android' || !!fsa().save;

/** Whether the person picks the format in the system's own save dialog (by the file type), so the app need not ask. */
export const dialogChoosesFormat = (): boolean => !!desktop() || (platform !== 'android' && !!fsa().save);

const aborted = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

async function androidFs() {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  return { Filesystem, Directory, Encoding };
}

/**
 * Ask where to save. Resolves null when the person cancels. The desktop app and browsers with file handles show their own dialog with the three
 * file types (the full project first, so it is what a plain "Save" makes); elsewhere `ask` is called to choose the format. Nothing is written yet.
 */
export async function chooseTarget(projectName: string, ask: () => Promise<ProjectFormat | null>): Promise<Target | null> {
  const d = desktop();
  if (d) {
    const r = await d.choose(projectFileName(projectName, 'full'));
    return r ? { ref: { kind: 'path', path: r.path }, name: baseName(r.path), format: formatOfName(r.path) } : null;
  }
  if (platform === 'android') {
    const format = await ask();
    if (!format) return null;
    const name = projectFileName(projectName, format);
    try {
      const { Filesystem, Directory } = await androidFs();
      await Filesystem.mkdir({ path: FOLDER, directory: Directory.Documents, recursive: true }).catch(() => {});
      // A second project with the same name must not overwrite the first.
      let path = `${FOLDER}/${name}`;
      for (let i = 2; await Filesystem.stat({ path, directory: Directory.Documents }).then(() => true, () => false); i++) path = `${FOLDER}/${name.slice(0, -FORMAT_EXT[format].length)} ${i}${FORMAT_EXT[format]}`;
      return { ref: { kind: 'path', path }, name: baseName(path), format };
    } catch {
      return { ref: null, name, format }; // storage not allowed: hand it to the share sheet instead
    }
  }
  const pick = fsa().save;
  if (pick) {
    try {
      const handle = await pick({ suggestedName: projectFileName(projectName, 'full'), types: SAVE_TYPES });
      return { ref: { kind: 'handle', handle }, name: handle.name, format: formatOfName(handle.name) };
    } catch (e) {
      if (aborted(e)) return null;
      throw e;
    }
  }
  const format = await ask();
  return format ? { ref: null, name: projectFileName(projectName, format), format } : null;
}

/** Write to the chosen place. A target without a reference is handed over as a download (or the share sheet). */
export async function writeTarget(t: Target, content: Content): Promise<void> {
  if (t.ref) return writeRef(t.ref, content);
  await saveFile(content, t.name, 'application/octet-stream');
}

async function write(handle: FileSystemFileHandle, content: Content): Promise<void> {
  const w = await handle.createWritable();
  try {
    await w.write(content);
  } finally {
    await w.close();
  }
}

/** Stream a Blob through the shell to a file: pieces of a few megabytes, and the file only replaces the old one when all of it arrived. */
async function writeThroughShell(d: DesktopApi, path: string, blob: Blob): Promise<void> {
  const id = await d.writeStart(path);
  let ok = false;
  try {
    for (let at = 0; at < blob.size; at += CHUNK) await d.writeChunk(id, new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
    ok = true;
  } finally {
    await d.writeEnd(id, ok);
  }
}

async function writeAndroid(path: string, content: Content): Promise<void> {
  const { Filesystem, Directory, Encoding } = await androidFs();
  if (typeof content === 'string') return void (await Filesystem.writeFile({ path, data: content, directory: Directory.Documents, encoding: Encoding.UTF8 }));
  for (let off = 0; off < Math.max(1, content.size); off += CHUNK) {
    const bytes = new Uint8Array(await content.slice(off, off + CHUNK).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const args = { path, data: btoa(bin), directory: Directory.Documents };
    await (off === 0 ? Filesystem.writeFile(args) : Filesystem.appendFile(args)); // the first piece creates (or empties) the file
  }
}

/** Whether a file can be written without asking the person (a browser handle needs its permission to still be granted). */
export async function canWriteQuietly(ref: ProjectRef): Promise<boolean> {
  if (ref.kind === 'path') return true;
  try {
    return (await (ref.handle as any).queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Write the project back to where it lives. Throws a sentence when the file cannot be written (moved, read-only, permission withdrawn). */
export async function writeRef(ref: ProjectRef, content: Content): Promise<void> {
  if (ref.kind === 'handle') {
    if ((await (ref.handle as any).requestPermission?.({ mode: 'readwrite' })) === 'denied') throw new Error('The browser did not allow writing to that file.');
    return write(ref.handle, content);
  }
  const d = desktop();
  if (d) return typeof content === 'string' ? d.write(ref.path, content) : writeThroughShell(d, ref.path, content);
  await writeAndroid(ref.path, content);
}

/** A file picked or dropped, read as a project or as a bundle (told apart by how it begins). */
export async function openedFromFile(file: Blob, name: string, ref: ProjectRef | null): Promise<OpenedProject> {
  return (await isBundle(file)) ? { name, ref, text: null, bundle: file } : { name, ref, text: await file.text(), bundle: null };
}

/** The bytes of a bundle on this computer or phone, as a Blob that does not depend on the file staying as it is. */
async function bundleFromPath(path: string): Promise<Blob> {
  if (desktop()) {
    const res = await fetch(new URL(`/project/${encodeURIComponent(path)}`, location.origin));
    if (!res.ok) throw new Error('the file has moved or been deleted');
    return res.blob();
  }
  const { Filesystem, Directory } = await androidFs();
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Documents });
  const res = await fetch(Capacitor.convertFileSrc(uri));
  if (!res.ok) throw new Error('the file has moved or been deleted');
  return res.blob();
}

export async function readRef(ref: ProjectRef): Promise<OpenedProject> {
  if (ref.kind === 'handle') {
    if ((await (ref.handle as any).requestPermission?.({ mode: 'read' })) === 'denied') throw new Error('The browser did not allow reading that file.');
    return openedFromFile(await ref.handle.getFile(), ref.handle.name, ref);
  }
  const name = baseName(ref.path);
  if (formatOfName(name) !== 'edit') return { name, ref, text: null, bundle: await bundleFromPath(ref.path) };
  const d = desktop();
  if (d) return { name, ref, text: (await d.read(ref.path)).text, bundle: null };
  const { Filesystem, Directory, Encoding } = await androidFs();
  const r = await Filesystem.readFile({ path: ref.path, directory: Directory.Documents, encoding: Encoding.UTF8 });
  return { name, ref, text: typeof r.data === 'string' ? r.data : await r.data.text(), bundle: null };
}

/** Ask for a project file and read it. Resolves null when the person cancels. */
export async function openDialog(): Promise<OpenedProject | null> {
  const d = desktop();
  if (d) {
    const r = await d.open();
    if (!r) return null;
    const ref: ProjectRef = { kind: 'path', path: r.path };
    return r.text === null ? { name: baseName(r.path), ref, text: null, bundle: await bundleFromPath(r.path) } : { name: baseName(r.path), ref, text: r.text, bundle: null };
  }
  const pick = fsa().open;
  if (pick) {
    try {
      const [handle] = await pick({ types: OPEN_TYPES, multiple: false });
      if (!handle) return null;
      return openedFromFile(await handle.getFile(), handle.name, { kind: 'handle', handle });
    } catch (e) {
      if (aborted(e)) return null;
      throw e;
    }
  }
  const f = (await pickFiles(OPEN_ACCEPT))[0];
  return f ? openedFromFile(f, f.name, null) : null;
}
