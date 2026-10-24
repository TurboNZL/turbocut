import { describe, expect, it } from 'vitest';
import { matchMedia, parseProject, projectFileName, serializeProject } from '../src/core/projectFile.ts';
import { addClip, createClip, createProject, splitAt } from '../src/core/timeline.ts';

const sample = () => {
  const p = createProject({ name: 'Short one', fps: 60 });
  p.assets.a1 = { id: 'a1', name: 'clip.mp4', ref: 'clip.mp4', hasVideo: true, hasAudio: true, size: 1234, duration: 600, width: 1080, height: 1920 };
  const c = createClip('a1', 0, 600);
  c.keys.x = [{ t: 0, v: 0, ease: 'linear' }, { t: 100, v: 50, ease: 'inOut' }];
  addClip(p, p.tracks[0]!.id, c);
  splitAt(p, c.id, 240);
  return p;
};

describe('a media entry that can be fetched again', () => {
  it('keeps a Twitch link through save and open, and drops anything else', () => {
    const p = sample();
    p.assets.a1!.source = { type: 'twitch', url: 'https://clips.twitch.tv/ProudPlainSlug' };
    expect(parseProject(serializeProject(p)).assets.a1!.source).toEqual({ type: 'twitch', url: 'https://clips.twitch.tv/ProudPlainSlug' });
    for (const bad of [{ type: 'twitch', url: 'https://evil.example/x' }, { type: 'twitch', url: 'http://clips.twitch.tv/x' }, { type: 'twitch', url: 'javascript:alert(1)' }, { type: 'ftp', url: 'https://clips.twitch.tv/x' }, { type: 'twitch', url: 5 }, 'https://clips.twitch.tv/x']) {
      const q = sample();
      (q.assets.a1 as any).source = bad;
      expect(parseProject(serializeProject(q)).assets.a1!.source, JSON.stringify(bad)).toBeUndefined();
    }
  });
});

describe('project files', () => {
  it('round-trips an edit exactly', () => {
    const p = sample();
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it('says why a file is not a project', () => {
    expect(() => parseProject('nope')).toThrow(/valid JSON/);
    expect(() => parseProject('{"format":"turbocut.layout"}')).toThrow(/not a TurboCut project/);
    expect(() => parseProject(JSON.stringify({ format: 'turbocut.project', version: 2, project: {} }))).toThrow(/newer TurboCut/);
    expect(() => parseProject(JSON.stringify({ format: 'turbocut.project', version: 1, project: {} }))).toThrow(/damaged/);
  });

  it('rejects damaged parts instead of loading them', () => {
    const bad = (mutate: (p: any) => void) => {
      const p: any = JSON.parse(JSON.stringify(sample()));
      mutate(p);
      return () => parseProject(JSON.stringify({ format: 'turbocut.project', version: 1, project: p }));
    };
    expect(bad((p) => (p.fps = 0))).toThrow(/frame rate/);
    expect(bad((p) => (p.width = 1e6))).toThrow(/size/);
    expect(bad((p) => (p.tracks[0].clips[0].duration = 1.5))).toThrow(/clip/);
    expect(bad((p) => (p.tracks[0].clips[0].assetId = 'ghost'))).toThrow(/not listed/);
    expect(bad((p) => (p.tracks[0].clips[1].id = p.tracks[0].clips[0].id))).toThrow(/clip/);
    expect(bad((p) => (p.tracks = p.tracks.filter((t: any) => t.kind === 'video')))).toThrow(/audio track/);
  });

  it('names the file after the project, safely', () => {
    expect(projectFileName('Short one')).toBe('Short one.turbocut');
    expect(projectFileName('a/b:c*?')).toBe('a b c.turbocut');
    expect(projectFileName('   ')).toBe('TurboCut project.turbocut');
  });

  it('finds media by name, and by size when two files share a name', () => {
    const assets = [{ id: 'a', name: 'x.mp4', size: 10 }, { id: 'b', name: 'x.mp4', size: 20 }, { id: 'c', name: 'y.mp4' }, { id: 'd', name: 'gone.mp4', size: 1 }];
    const files = [{ name: 'x.mp4', size: 20 }, { name: 'x.mp4', size: 10 }, { name: 'y.mp4', size: 5 }];
    const m = matchMedia(assets, files);
    expect(Object.fromEntries(m)).toEqual({ a: 1, b: 0, c: 2 });
  });

  it('falls back to the name alone when the size changed', () => {
    const m = matchMedia([{ id: 'a', name: 'x.mp4', size: 10 }], [{ name: 'x.mp4', size: 11 }]);
    expect(m.get('a')).toBe(0);
  });
});
