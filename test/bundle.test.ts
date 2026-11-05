import { describe, expect, it } from 'vitest';
import { BUNDLE_MAGIC, isBundle, packBundle, partName, unpackBundle } from '../src/core/bundle.ts';
import { FORMAT_EXT, formatOfName, projectFileName } from '../src/core/projectFile.ts';

const part = (kind: any, name: string, text: string) => ({ kind, name, blob: new Blob([text]) });

describe('project bundle', () => {
  it('round-trips parts without changing a byte', async () => {
    const bytes = new Uint8Array([0, 255, 1, 2, 3, 128]);
    const blob = packBundle([part('project', 'project.turbocut', '{"a":1}'), { kind: 'media', name: 'clip.mp4', blob: new Blob([bytes]) }, part('font', 'F.ttf', 'ff'), part('preset', 'style.json', '{}')]);
    expect(await isBundle(blob)).toBe(true);
    const parts = await unpackBundle(blob);
    expect(parts.map((p) => `${p.kind}:${p.name}`)).toEqual(['project:project.turbocut', 'media:clip.mp4', 'font:F.ttf', 'preset:style.json']);
    expect(await parts[0]!.blob.text()).toBe('{"a":1}');
    expect(new Uint8Array(await parts[1]!.blob.arrayBuffer())).toEqual(bytes);
  });

  it('is not mistaken for a plain project', async () => {
    expect(await isBundle(new Blob(['{"format":"turbocut.project"}']))).toBe(false);
    await expect(unpackBundle(new Blob(['{}']))).rejects.toThrow(/not a TurboCut project/);
  });

  it('says so when the file was cut short or damaged', async () => {
    const whole = await packBundle([part('project', 'p', '{"a":1}'), part('media', 'm.mp4', 'x'.repeat(100))]).arrayBuffer();
    await expect(unpackBundle(new Blob([whole.slice(0, whole.byteLength - 10)]))).rejects.toThrow(/cut short/);
    await expect(unpackBundle(new Blob([whole.slice(0, BUNDLE_MAGIC.length + 2)]))).rejects.toThrow(/cut short/);
    const bad = new Uint8Array(whole.slice(0));
    bad[BUNDLE_MAGIC.length] = 0xff; // an impossible header length
    bad[BUNDLE_MAGIC.length + 1] = 0xff;
    await expect(unpackBundle(new Blob([bad]))).rejects.toThrow(/damaged/);
    await expect(unpackBundle(packBundle([part('media', 'm', 'x')]))).rejects.toThrow(/no project/);
  });

  it('keeps part names from being paths', () => {
    expect(partName('../../etc/passwd', 'media')).toBe('passwd');
    expect(partName('C:\\x\\clip.mp4', 'media')).toBe('clip.mp4');
    expect(partName('..', 'media')).toBe('media');
  });

  it('knows the three formats by their extension', () => {
    expect(FORMAT_EXT).toEqual({ edit: '.turbocut', clips: '.turbocutc', full: '.turbocutf' });
    expect(formatOfName('a.turbocutf')).toBe('full');
    expect(formatOfName('A.TURBOCUTC')).toBe('clips');
    expect(formatOfName('a.turbocut')).toBe('edit');
    expect(formatOfName('a.json')).toBe('edit');
    expect(projectFileName('Short', 'full')).toBe('Short.turbocutf');
  });
});
