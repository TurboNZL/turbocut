import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { ProjectLibrary } = createRequire(import.meta.url)('../electron/projectLibrary.cjs');

function lib() {
  const root = mkdtempSync(join(tmpdir(), 'tclib-'));
  const l = new ProjectLibrary({ defaultDir: join(root, 'appdata', 'Projects'), configFile: join(root, 'appdata', 'project-folders.json'), documents: () => join(root, 'Documents') });
  const personal = join(root, 'Documents', 'Edits');
  mkdirSync(personal, { recursive: true });
  return { l, root, personal, again: () => new ProjectLibrary({ defaultDir: join(root, 'appdata', 'Projects'), configFile: join(root, 'appdata', 'project-folders.json'), documents: () => join(root, 'Documents') }) };
}
const touch = (file: string, text = 'x', secondsAgo = 0) => {
  writeFileSync(file, text);
  const t = (Date.now() - secondsAgo * 1000) / 1000;
  utimesSync(file, t, t);
};

describe('the project folders', () => {
  it('start with the app-data folder only; a folder the person adds is read too, and survives a restart', () => {
    const { l, personal, again } = lib();
    expect(l.folders()).toEqual([{ path: l.defaultDir, kind: 'default', exists: true }]);
    l.addFolder(personal);
    expect(l.folders().map((f: any) => [f.kind, f.exists])).toEqual([['default', true], ['personal', true]]);
    expect(again().folders().map((f: any) => f.path)).toEqual([l.defaultDir, personal]);
    l.removeFolder(personal);
    expect(again().folders()).toHaveLength(1);
  });

  it('refuses a path that is not a folder, and lists the default folder only once', () => {
    const { l, root } = lib();
    expect(() => l.addFolder(join(root, 'nope'))).toThrow(/cannot be used/);
    expect(() => l.addFolder('relative/dir')).toThrow(/cannot be used/);
    l.ensureDefault();
    l.addFolder(l.defaultDir);
    expect(l.folders()).toHaveLength(1);
  });

  it('keeps a folder that disappeared in the list, flagged, and lists nothing from it', () => {
    const { l, personal } = lib();
    l.addFolder(personal);
    touch(join(personal, 'a.turbocutf'));
    expect(l.list()).toHaveLength(1);
    require('node:fs').rmSync(personal, { recursive: true });
    expect(l.folders()[1]).toMatchObject({ kind: 'personal', exists: false });
    expect(l.list()).toEqual([]);
  });
});

describe('listing projects', () => {
  it('lists project files of every folder, newest first, and nothing else', () => {
    const { l, personal } = lib();
    l.addFolder(personal);
    touch(join(l.ensureDefault(), 'old.turbocutf'), 'aaaa', 300);
    touch(join(personal, 'new.turbocut'), 'bb', 10);
    touch(join(personal, 'clips.turbocutc'), 'c', 100);
    touch(join(personal, 'notes.txt'));
    touch(join(personal, 'video.mp4'));
    mkdirSync(join(personal, 'sub.turbocutf')); // a folder with a project name is not a project
    const list = l.list();
    expect(list.map((e: any) => e.name)).toEqual(['new.turbocut', 'clips.turbocutc', 'old.turbocutf']);
    expect(list[0]).toMatchObject({ kind: 'personal', size: 2, folder: personal });
    expect(list[2]).toMatchObject({ kind: 'default', size: 4 });
  });
});

describe('where saving starts', () => {
  it('new projects go to the default folder until another listed folder is chosen; an unlisted one is refused', () => {
    const { l, personal, again } = lib();
    l.addFolder(personal);
    expect(l.saveFolder()).toBe(l.defaultDir);
    l.setSaveFolder(personal);
    expect(again().saveFolder()).toBe(personal);
    expect(() => l.setSaveFolder('/etc')).toThrow(/not one of/);
    l.setSaveFolder(null);
    expect(l.saveFolder()).toBe(l.defaultDir);
    l.setSaveFolder(personal);
    l.removeFolder(personal); // choosing a folder and then removing it falls back to the default
    expect(l.saveFolder()).toBe(l.defaultDir);
  });

  it('the dialogs start in the last folder used (not the home folder), and fall back when it is gone', () => {
    const { l, root, personal } = lib();
    expect(l.startDir()).toBe(l.defaultDir);
    const elsewhere = join(root, 'Videos', 'Edits');
    mkdirSync(elsewhere, { recursive: true });
    l.remember(join(elsewhere, 'short.turbocutf'));
    expect(l.startDir()).toBe(elsewhere);
    expect(new ProjectLibrary({ defaultDir: l.defaultDir, configFile: l.configFile, documents: () => root }).startDir()).toBe(elsewhere); // after a restart
    l.remember(join(personal, 'x.turbocutf'));
    expect(l.startDir()).toBe(personal);
    require('node:fs').rmSync(personal, { recursive: true });
    expect(l.startDir()).toBe(l.defaultDir);
  });
});

describe('files that arrive and files that are renamed', () => {
  it('a received project is moved into the save folder under a free name', () => {
    const { l, root } = lib();
    const src = join(root, 'incoming.bin');
    touch(src, 'BUNDLE');
    const first = l.importFile(src, 'My short.turbocutf');
    expect(first).toBe(join(l.defaultDir, 'My short.turbocutf'));
    expect(readFileSync(first, 'utf8')).toBe('BUNDLE');
    expect(existsSync(src)).toBe(false);
    touch(src, 'SECOND');
    expect(l.importFile(src, 'My short.turbocutf')).toBe(join(l.defaultDir, 'My short 2.turbocutf'));
    touch(src, 'THIRD');
    expect(l.importFile(src, '../../evil/..\\name')).toBe(join(l.defaultDir, 'name.turbocutf')); // a name cannot escape the folder
  });

  it('rename keeps the extension, refuses a taken name, and only touches files in the listed folders', () => {
    const { l, root } = lib();
    const a = join(l.ensureDefault(), 'a.turbocutf');
    touch(a);
    touch(join(l.defaultDir, 'b.turbocutf'));
    expect(l.rename(a, 'Renamed')).toBe(join(l.defaultDir, 'Renamed.turbocutf'));
    expect(() => l.rename(join(l.defaultDir, 'Renamed.turbocutf'), 'b')).toThrow(/already a project called b\.turbocutf/);
    expect(() => l.rename(join(l.defaultDir, 'Renamed.turbocutf'), '  ')).toThrow(/Give it a name/);
    const outside = join(root, 'other.turbocutf');
    touch(outside);
    expect(l.owns(outside)).toBe(false);
    expect(() => l.rename(outside, 'x')).toThrow(/not in a TurboCut project folder/);
    expect(l.owns(join(l.defaultDir, 'b.turbocutf'))).toBe(true);
    expect(l.owns(join(l.defaultDir, 'notes.txt'))).toBe(false);
  });
});
