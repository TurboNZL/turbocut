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

/** Import a font file. Returns the family names it is now available under. */
export async function importFont(file: File): Promise<string[]> {
  const bytes = await file.arrayBuffer();
  let families = fontFamilies(bytes);
  if (families.length === 0) families = [file.name.replace(/\.(otf|ttf|woff2?)$/i, '').replace(/[-_]+/g, ' ').trim()];
  const rec: StoredFont = { families, bytes };
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
