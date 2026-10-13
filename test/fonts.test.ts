import { describe, expect, it } from 'vitest';
import { fontFamilies } from '../src/app/fonts.ts';

/** A minimal OpenType file with only a 'name' table, so the test needs no real font. */
function fakeFont(names: [id: number, text: string][]): ArrayBuffer {
  const strings = names.map(([, t]) => {
    const b = new Uint8Array(t.length * 2);
    for (let i = 0; i < t.length; i++) (b[i * 2] = 0), (b[i * 2 + 1] = t.charCodeAt(i));
    return b;
  });
  const nameLen = 6 + names.length * 12 + strings.reduce((n, s) => n + s.length, 0);
  const buf = new ArrayBuffer(12 + 16 + nameLen);
  const v = new DataView(buf);
  v.setUint32(0, 0x4f54544f); // 'OTTO'
  v.setUint16(4, 1);
  v.setUint32(12, 0x6e616d65); // 'name'
  v.setUint32(20, 28);
  v.setUint32(24, nameLen);
  const t = 28;
  v.setUint16(t + 2, names.length);
  v.setUint16(t + 4, 6 + names.length * 12);
  let off = 0;
  names.forEach(([id], i) => {
    const r = t + 6 + i * 12;
    v.setUint16(r, 3); // Windows platform, UTF-16BE
    v.setUint16(r + 6, id);
    v.setUint16(r + 8, strings[i]!.length);
    v.setUint16(r + 10, off);
    new Uint8Array(buf, t + 6 + names.length * 12 + off, strings[i]!.length).set(strings[i]!);
    off += strings[i]!.length;
  });
  return buf;
}

describe('fontFamilies', () => {
  it('collects family, full and typographic names and ignores the rest', () => {
    const names = fontFamilies(fakeFont([[1, 'Squad Latin'], [2, 'Regular'], [4, 'Squad Latin Black'], [6, 'SquadLatin-Black']]));
    expect(names.sort()).toEqual(['Squad Latin', 'Squad Latin Black']);
  });
  it('returns nothing for non-sfnt data', () => {
    expect(fontFamilies(new ArrayBuffer(4))).toEqual([]);
    expect(fontFamilies(new TextEncoder().encode('wOF2 not a real font, long enough').buffer as ArrayBuffer)).toEqual([]);
  });
});
