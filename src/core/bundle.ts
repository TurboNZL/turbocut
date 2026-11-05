/**
 * The container behind the `.turbocutf` and `.turbocutc` project files: several named parts in one file (the project as JSON, the media
 * files, the fonts, the caption style). Built to be written and read without ever holding the whole file in memory:
 *
 *   "TURBOCUT-BUNDLE-1\n"  then, for each part:  u32 header length (little endian), header (JSON: kind, name, size), then `size` bytes.
 *
 * `packBundle` returns a Blob that points at the parts instead of copying them, and `unpackBundle` hands back slices of the file it was
 * given, so a multi-gigabyte bundle opens in the time it takes to read its headers. Everything read from a file is checked: a part that
 * claims to run past the end of the file means the file was cut short (a copy that did not finish), and is said so.
 */
export const BUNDLE_MAGIC = 'TURBOCUT-BUNDLE-1\n';
export type BundleKind = 'project' | 'preset' | 'font' | 'media';
const KINDS = new Set<string>(['project', 'preset', 'font', 'media']);
const MAX_HEADER = 4096;
const MAX_PARTS = 5000;

export interface BundlePart {
  kind: BundleKind;
  name: string;
  blob: Blob;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A part name that cannot be a path: the last segment, no control characters, a sensible length. */
export function partName(name: string, fallback: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]+/g, '').trim().slice(0, 200);
  return base && base !== '.' && base !== '..' ? base : fallback;
}

export function packBundle(parts: BundlePart[]): Blob {
  const out: BlobPart[] = [enc.encode(BUNDLE_MAGIC)];
  for (const p of parts) {
    const head = enc.encode(JSON.stringify({ kind: p.kind, name: partName(p.name, p.kind), size: p.blob.size }));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, head.length, true);
    out.push(len, head, p.blob);
  }
  return new Blob(out, { type: 'application/octet-stream' });
}

/** Whether this file begins like a bundle (a plain project starts with `{`). */
export async function isBundle(blob: Blob): Promise<boolean> {
  try {
    return dec.decode(await blob.slice(0, BUNDLE_MAGIC.length).arrayBuffer()) === BUNDLE_MAGIC;
  } catch {
    return false;
  }
}

/** Read the parts of a bundle. Throws a sentence for the person when the file is not one, or is damaged or cut short. */
export async function unpackBundle(blob: Blob): Promise<BundlePart[]> {
  if (!(await isBundle(blob))) throw new Error('That is not a TurboCut project file.');
  const parts: BundlePart[] = [];
  let at = BUNDLE_MAGIC.length;
  while (at < blob.size) {
    if (parts.length >= MAX_PARTS) throw new Error('The project file holds too many parts.');
    if (at + 4 > blob.size) throw new Error('The project file was cut short. Copy it again from where it came from.');
    const hlen = new DataView(await blob.slice(at, at + 4).arrayBuffer()).getUint32(0, true);
    at += 4;
    if (hlen < 2 || hlen > MAX_HEADER || at + hlen > blob.size) throw new Error('The project file is damaged.');
    let head: any;
    try {
      head = JSON.parse(dec.decode(await blob.slice(at, at + hlen).arrayBuffer()));
    } catch {
      throw new Error('The project file is damaged.');
    }
    at += hlen;
    if (!head || !KINDS.has(head.kind) || !Number.isSafeInteger(head.size) || head.size < 0) throw new Error('The project file is damaged.');
    if (at + head.size > blob.size) throw new Error('The project file was cut short. Copy it again from where it came from.');
    parts.push({ kind: head.kind, name: partName(head.name, head.kind), blob: blob.slice(at, at + head.size) });
    at += head.size;
  }
  if (!parts.some((p) => p.kind === 'project')) throw new Error('The project file has no project in it.');
  return parts;
}
