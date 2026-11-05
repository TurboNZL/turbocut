import type { Asset } from '../core/types.ts';

/**
 * A browser or a phone never tells a page where a picked file lives, so a saved project cannot find its videos again by itself. TurboCut keeps a
 * copy of what was imported in its own private storage (the origin-private file system; nothing the person can see or has to manage) and the
 * project looks there first when it is opened: the media bin, in effect, remembers where each file is. The desktop app does not need this, it
 * remembers real paths (`mediaPaths.ts`). Files are found by name and size, the same way a project matches files the person picks.
 * Where private storage is missing, copies are held in memory for the session instead, so that leaving a project and coming back still works.
 */
const DIR = 'turbocut-media';
/** The most copies kept; the oldest go first. */
export const MEMORY_CAP = 4 * 1024 ** 3;
const RAM_CAP = 1024 ** 3;

const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};
const keyOf = (name: string, size: number): string => `${size}-${fnv(name)}`;

const ram = new Map<string, { file: Blob; at: number }>();
const ramBytes = () => [...ram.values()].reduce((n, x) => n + x.file.size, 0);

const hasOpfs = (): boolean => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;

async function dir(): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true });
}

async function* entries(d: FileSystemDirectoryHandle): AsyncGenerator<[string, FileSystemFileHandle]> {
  for await (const [n, h] of (d as any).entries() as AsyncIterable<[string, FileSystemHandle]>) if (h.kind === 'file') yield [n, h as FileSystemFileHandle];
}

/** Keep a copy of an imported file. Quiet: a full disk or a missing feature just means the project will ask for the file next time. */
export async function keepCopy(file: Blob, name: string): Promise<void> {
  const key = keyOf(name, file.size);
  try {
    if (!hasOpfs()) {
      ram.set(key, { file, at: Date.now() });
      while (ramBytes() > RAM_CAP && ram.size > 1) ram.delete([...ram.entries()].sort((a, b) => a[1].at - b[1].at)[0]![0]);
      return;
    }
    const d = await dir();
    const have = await d.getFileHandle(key).then((h) => h.getFile(), () => null);
    if (have && have.size === file.size) return;
    const w = await (await d.getFileHandle(key, { create: true })).createWritable();
    await file.stream().pipeTo(w as unknown as WritableStream); // streamed: a long video is never held in memory
    await trim(d, key);
  } catch {
    /* storage full or blocked */
  }
}

/** Delete the oldest copies until the rest fit under the cap. */
async function trim(d: FileSystemDirectoryHandle, keep: string): Promise<void> {
  const all: { n: string; size: number; at: number }[] = [];
  for await (const [n, h] of entries(d)) {
    const f = await h.getFile();
    all.push({ n, size: f.size, at: f.lastModified });
  }
  let total = all.reduce((n, x) => n + x.size, 0);
  for (const x of all.sort((a, b) => a.at - b.at)) {
    if (total <= MEMORY_CAP) break;
    if (x.n === keep) continue;
    await d.removeEntry(x.n).catch(() => {});
    total -= x.size;
  }
}

/** The files this project needs that were kept, each under the name the project knows it by. */
export async function recallCopies(assets: Pick<Asset, 'name' | 'size'>[]): Promise<File[]> {
  const out: File[] = [];
  for (const a of assets) {
    try {
      let blob: Blob | undefined;
      if (hasOpfs()) {
        const d = await dir();
        if (a.size !== undefined) blob = await d.getFileHandle(keyOf(a.name, a.size)).then((h) => h.getFile(), () => undefined);
        else for await (const [n, h] of entries(d)) if (n.endsWith(`-${fnv(a.name)}`)) blob = await h.getFile();
      } else {
        blob = a.size !== undefined ? ram.get(keyOf(a.name, a.size))?.file : [...ram.entries()].find(([k]) => k.endsWith(`-${fnv(a.name)}`))?.[1].file;
      }
      if (blob) out.push(new File([blob], a.name));
    } catch {
      /* unreadable: it stays in the list of media to find */
    }
  }
  return out;
}

/** How much private storage the copies use, in bytes. */
export async function memoryUsage(): Promise<number> {
  if (!hasOpfs()) return ramBytes();
  let n = 0;
  try {
    for await (const [, h] of entries(await dir())) n += (await h.getFile()).size;
  } catch {
    /* none yet */
  }
  return n;
}

/** Forget every copy. */
export async function forgetCopies(): Promise<void> {
  ram.clear();
  if (!hasOpfs()) return;
  try {
    await (await navigator.storage.getDirectory()).removeEntry(DIR, { recursive: true });
  } catch {
    /* nothing there */
  }
}
