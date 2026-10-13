/**
 * Fonts the user brings (for caption presets). They are stored in IndexedDB and registered with the
 * document on every start, so a preset that names "Squad Latin Black" keeps working after a restart.
 * TurboCut does not ship third-party fonts: you import the files you have the right to use.
 */
const DB = 'turbocut.fonts';
const STORE = 'fonts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const tx = <T>(db: IDBDatabase, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const req = f(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export interface StoredFont {
  /** Every family name the font declares, so styles that ask for any of them find it. */
  families: string[];
  bytes: ArrayBuffer;
}

/**
 * Family names (name IDs 1, 4 and 16) from the 'name' table of an OpenType/TrueType file.
 * Returns [] for WOFF/WOFF2 (compressed tables); the caller falls back to the file name.
 */
export function fontFamilies(bytes: ArrayBuffer): string[] {
  const v = new DataView(bytes);
  if (v.byteLength < 12) return [];
  const tag = v.getUint32(0);
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return []; // not sfnt
  const numTables = v.getUint16(4);
  let nameOff = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (v.getUint32(rec) === 0x6e616d65 /* 'name' */) nameOff = v.getUint32(rec + 8);
  }
  if (nameOff < 0) return [];
  const count = v.getUint16(nameOff + 2);
  const strings = nameOff + v.getUint16(nameOff + 4);
  const out = new Set<string>();
  for (let i = 0; i < count; i++) {
    const r = nameOff + 6 + i * 12;
    const platform = v.getUint16(r);
    const id = v.getUint16(r + 6);
    if (id !== 1 && id !== 4 && id !== 16) continue;
    const len = v.getUint16(r + 8);
    const off = strings + v.getUint16(r + 10);
    let text = '';
    if (platform === 3 || platform === 0) for (let j = 0; j + 1 < len; j += 2) text += String.fromCharCode(v.getUint16(off + j));
    else for (let j = 0; j < len; j++) text += String.fromCharCode(v.getUint8(off + j));
    if (text.trim()) out.add(text.trim());
  }
  return [...out];
}

async function register(f: StoredFont): Promise<void> {
  for (const family of f.families) {
    const face = new FontFace(family, f.bytes.slice(0));
    await face.load();
    document.fonts.add(face);
  }
}

const unquote = (family: string) => family.replace(/^["']|["']$/g, '');

function unregister(families: string[]): void {
  const gone = new Set(families.map((f) => f.toLowerCase()));
  for (const face of [...document.fonts]) if (gone.has(unquote(face.family).toLowerCase())) document.fonts.delete(face);
}

export interface FontEntry {
  key: IDBValidKey;
  families: string[];
  /** File size in bytes. */
  size: number;
}

/** The fonts the person added, with the key to remove each one. */
export async function listFonts(): Promise<FontEntry[]> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const out: FontEntry[] = [];
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        const f = c.value as StoredFont;
        out.push({ key: c.key, families: f.families, size: f.bytes.byteLength });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Forget a font: it disappears from this device and from the page right away. */
export async function removeFont(entry: FontEntry): Promise<void> {
  unregister(entry.families);
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(entry.key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* nothing stored */
  }
}

let probe: CanvasRenderingContext2D | null = null;
/** Is a font with this name available to the page (a system font or one that was added)? Compares text widths against the fallbacks. */
export function fontAvailable(name: string): boolean {
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe) return true;
  const sample = 'mmmmmmmmmmlliWWW0123';
  for (const base of ['monospace', 'serif', 'sans-serif']) {
    probe.font = `72px ${base}`;
    const plain = probe.measureText(sample).width;
    probe.font = `72px "${name.replace(/"/g, '')}", ${base}`;
    if (probe.measureText(sample).width !== plain) return true;
  }
  return false;
}

/** Import a font file. Returns the family names it is now available under. */
export async function importFont(file: File): Promise<string[]> {
  const bytes = await file.arrayBuffer();
  let families = fontFamilies(bytes);
  if (families.length === 0) families = [file.name.replace(/\.(otf|ttf|woff2?)$/i, '').replace(/[-_]+/g, ' ').trim()];
  const rec: StoredFont = { families, bytes };
  const same = new Set(families.map((f) => f.toLowerCase()));
  for (const old of await listFonts()) if (old.families.some((f) => same.has(f.toLowerCase()))) await removeFont(old); // adding it again replaces it
  await register(rec);
  try {
    await tx(await open(), 'readwrite', (s) => s.put(rec));
  } catch {
    // Storage can be blocked (private mode); the font still works for this session.
  }
  return families;
}

export async function loadStoredFonts(): Promise<string[]> {
  try {
    const all = await tx<StoredFont[]>(await open(), 'readonly', (s) => s.getAll());
    await Promise.all(all.map((f) => register(f).catch(() => {})));
    return all.flatMap((f) => f.families);
  } catch {
    return [];
  }
}

/** The imported font files that declare any of these family names (system fonts like Arial are not in here). */
export async function fontsForFamilies(families: string[]): Promise<StoredFont[]> {
  const want = new Set(families.map((f) => f.toLowerCase()));
  try {
    const all = await tx<StoredFont[]>(await open(), 'readonly', (s) => s.getAll());
    return all.filter((f) => f.families.some((x) => want.has(x.toLowerCase())));
  } catch {
    return [];
  }
}

export function toBase64(bytes: ArrayBuffer): string {
  const u = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

/** Register and remember fonts that arrived inside a preset file. Returns the family names now available. */
export async function installFonts(fonts: { families: string[]; data: string }[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of fonts) {
    const rec: StoredFont = { families: f.families, bytes: fromBase64(f.data) };
    await register(rec);
    try {
      await tx(await open(), 'readwrite', (s) => s.put(rec));
    } catch {
      /* storage blocked: the font works this session */
    }
    out.push(...f.families);
  }
  return out;
}
