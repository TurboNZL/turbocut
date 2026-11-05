import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { baseName } from '../src/app/projectFiles.ts';
import { createProject } from '../src/core/timeline.ts';
import { parseProject, serializeProject } from '../src/core/projectFile.ts';
import { filesFromPaths } from '../src/app/mediaPaths.ts';

const { projectPath, mediaPath, bundlePath, writeAtomic, readProject, Writers } = createRequire(import.meta.url)('../electron/projectFiles.cjs');

describe('project files on the desktop', () => {
  it('only reads and writes absolute paths that end in .turbocut, .turbocutc, .turbocutf (or .json)', () => {
    expect(projectPath('/home/me/My short.turbocut')).toBe('/home/me/My short.turbocut');
    expect(projectPath('/home/me/My short.turbocutf')).toBe('/home/me/My short.turbocutf');
    expect(projectPath('/home/me/My short.TURBOCUTC')).toBe('/home/me/My short.TURBOCUTC');
    for (const bad of ['', 'relative.turbocut', '/etc/passwd', '/home/me/x.turbocut\0.txt', '/home/me/video.mp4', 42, null]) expect(() => projectPath(bad as any), String(bad)).toThrow();
  });

  it('writes through a temporary file, so a project is whole or untouched, and leaves nothing behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tcproj-'));
    const f = join(dir, 'a.turbocut');
    writeAtomic(f, 'one');
    writeAtomic(f, 'two');
    expect(readFileSync(f, 'utf8')).toBe('two');
    expect(readdirSync(dir)).toEqual(['a.turbocut']);
    expect(() => writeAtomic(join(dir, 'missing', 'b.turbocut'), 'x')).toThrow();
    expect(readdirSync(dir)).toEqual(['a.turbocut']);
  });

  it('round-trips a project through a file and refuses a folder or a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tcproj-'));
    const f = join(dir, 'p.turbocut');
    const p = createProject({ name: 'Round trip', fps: 30 });
    writeAtomic(f, serializeProject(p));
    expect(parseProject(readProject(f)).name).toBe('Round trip');
    expect(() => readProject(dir)).toThrow();
    expect(() => readProject(join(dir, 'nope.turbocut'))).toThrow();
  });

  it('serves media only from an existing file with a media extension', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tcmedia-'));
    const v = join(dir, 'clip.mp4');
    writeFileSync(v, 'x');
    writeFileSync(join(dir, 'secret.txt'), 'x');
    expect(mediaPath(v)).toBe(v);
    expect(mediaPath(join(dir, 'secret.txt'))).toBeNull();
    expect(mediaPath(join(dir, 'gone.mp4'))).toBeNull();
    expect(mediaPath('clip.mp4')).toBeNull();
    expect(mediaPath(dir + '.mp4')).toBeNull();
  });

  it('names the last part of a path, whichever separator it uses', () => {
    expect(baseName('/home/me/My short.turbocut')).toBe('My short.turbocut');
    expect(baseName('C:\\Users\\me\\short.turbocut')).toBe('short.turbocut');
  });
});

describe('media paths in a project', () => {
  it('a saved path survives the file; a path that is not a sensible string is dropped', () => {
    const p = createProject({ name: 'P', fps: 30 });
    p.assets.a = { id: 'a', name: 'x.mp4', ref: 'x.mp4', hasVideo: true, hasAudio: false, duration: 30, width: 1, height: 1, path: '/v/x.mp4' } as any;
    p.assets.b = { id: 'b', name: 'y.mp4', ref: 'y.mp4', hasVideo: true, hasAudio: false, duration: 30, width: 1, height: 1, path: 42 } as any;
    const back = parseProject(serializeProject(p));
    expect(back.assets.a!.path).toBe('/v/x.mp4');
    expect(back.assets.b!.path).toBeUndefined();
  });

  it('opens nothing by path outside the desktop app', async () => {
    expect(await filesFromPaths([{ name: 'x.mp4', path: '/v/x.mp4', size: 1 }])).toEqual([]);
  });
});

describe('saving a bundle in pieces', () => {
  it('writes the pieces to a temporary file and only replaces the project when the last one is in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tcbundle-'));
    const f = join(dir, 'big.turbocutf');
    writeFileSync(f, 'old');
    const w = new Writers();
    const id = w.start(f);
    w.chunk(id, new Uint8Array([1, 2, 3]));
    w.chunk(id, new Uint8Array([4, 5]));
    expect(readFileSync(f, 'utf8')).toBe('old'); // not yet
    w.end(id, true);
    expect([...readFileSync(f)]).toEqual([1, 2, 3, 4, 5]);
    expect(readdirSync(dir)).toEqual(['big.turbocutf']);
  });

  it('a cancelled or failed save leaves the old file and no leftovers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tcbundle-'));
    const f = join(dir, 'big.turbocutf');
    writeFileSync(f, 'old');
    const w = new Writers();
    const id = w.start(f);
    w.chunk(id, new Uint8Array([9]));
    w.end(id, false);
    expect(readFileSync(f, 'utf8')).toBe('old');
    expect(readdirSync(dir)).toEqual(['big.turbocutf']);
    expect(() => w.chunk(id, new Uint8Array([1]))).toThrow(/over/);
  });

  it('allows only a few saves at once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tcbundle-'));
    const w = new Writers();
    for (let i = 0; i < 4; i++) w.start(join(dir, `${i}.turbocutf`));
    expect(() => w.start(join(dir, 'x.turbocutf'))).toThrow(/at once/);
  });

  it('serves a bundle path only for an existing bundle file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tcbundle-'));
    const f = join(dir, 'a.turbocutf');
    writeFileSync(f, 'x');
    writeFileSync(join(dir, 'plain.turbocut'), 'x');
    expect(bundlePath(f)).toBe(f);
    for (const bad of [join(dir, 'plain.turbocut'), join(dir, 'missing.turbocutf'), '/etc/passwd', 'a.turbocutf', f + '\0x', dir]) expect(bundlePath(bad), String(bad)).toBeNull();
  });
});
