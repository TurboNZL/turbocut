import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanCode, parseAddress, pullShelf } from '../src/app/pull.ts';

const { Share } = createRequire(import.meta.url)('../electron/share.cjs');
const made: any[] = [];
afterEach(() => {
  while (made.length) made.pop().stop();
});
async function computer() {
  const s = new Share({ dir: mkdtempSync(join(tmpdir(), 'tcpull-')), name: 'Studio PC', version: '1', port: 0 });
  made.push(s);
  s.startDiscovery = async () => {};
  await s.start();
  return s;
}
async function put(s: any, parts: [string, string, Buffer][]) {
  const { id } = s.shelfOpen({ project: 'p', media: 0, fonts: 0, links: 2, bytes: 0 });
  for (const [kind, name, data] of parts) {
    const w = s.shelfPart(id, kind, name);
    await w.write(data);
    await w.end();
  }
  return s.shelfReady(id);
}

describe('addresses and codes typed on a phone', () => {
  it('accepts an address with or without a port or scheme, and nothing else', () => {
    expect(parseAddress('192.168.1.20')).toBe('http://192.168.1.20:47903');
    expect(parseAddress(' http://192.168.1.20:5000/ ')).toBe('http://192.168.1.20:5000');
    expect(parseAddress('studio.local')).toBe('http://studio.local:47903');
    for (const bad of ['', 'a b', '192.168.1.20:99999', 'x@y']) expect(parseAddress(bad), bad).toBeNull();
    expect(cleanCode('482 913')).toBe('482913');
    expect(cleanCode('48-29-13x99')).toBe('482913');
  });
});

describe('pulling a shelf', () => {
  it('brings the project, style, fonts and media across with progress', async () => {
    const pc = await computer();
    const video = Buffer.alloc(200_000, 3);
    const info = await put(pc, [['project', 'project.turbocut', Buffer.from('{"project":true}')], ['preset', 'style.json', Buffer.from('{"p":1}')], ['font', 'Squad.ttf', Buffer.from('FONT')], ['media', 'clip.mp4', video]]);
    const steps: number[] = [];
    const got = await pullShelf(`127.0.0.1:${info.port}`, `${info.code.slice(0, 3)} ${info.code.slice(3)}`, { onProgress: (d, t) => steps.push(d / t) });
    expect(got.from).toBe('Studio PC');
    expect(got.project).toBe('{"project":true}');
    expect(got.preset).toBe('{"p":1}');
    expect(got.links).toBe(2);
    expect(got.fonts.map((f) => [f.name, f.size])).toEqual([['Squad.ttf', 4]]);
    expect(got.media.map((f) => [f.name, f.size])).toEqual([['clip.mp4', 200_000]]);
    expect(Buffer.from(await got.media[0]!.arrayBuffer()).equals(video)).toBe(true);
    expect(steps.at(-1)).toBe(1);
    // fetching tells the computer it is done, which closes the shelf
    expect(pc.shelves.size).toBe(0);
  });

  it('says what is wrong in words: a wrong code, a bad address, a computer that is not there', async () => {
    const pc = await computer();
    const info = await put(pc, [['project', 'p', Buffer.from('{}')]]);
    const wrong = info.code === '111111' ? '222222' : '111111';
    await expect(pullShelf(`127.0.0.1:${info.port}`, wrong)).rejects.toThrow(/code is not right/);
    await expect(pullShelf('not an address', '123456')).rejects.toThrow(/address/);
    await expect(pullShelf('127.0.0.1', '12345')).rejects.toThrow(/six digits/);
    await expect(pullShelf('127.0.0.1:9', '123456')).rejects.toThrow(/Could not reach/);
  });
});
