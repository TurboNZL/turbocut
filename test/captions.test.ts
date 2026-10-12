import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { formatColour, formatTime, parseAss, parseColour, parseTime, writeAss } from '../src/captions/ass.ts';
import { entranceScale, entranceTags, exportPreset, importPreset, presetFromAss, PresetError } from '../src/captions/presets.ts';
import { bounce } from '../src/core/easing.ts';

const sample = readFileSync(new URL('./fixtures/sample.ass', import.meta.url), 'utf8');

describe('ASS', () => {
  it('parses the real Kdenlive export', () => {
    const f = parseAss(sample);
    expect(f.playResX).toBe(1080);
    expect(f.playResY).toBe(1920);
    expect(f.styles.map((s) => s.name)).toEqual(['Default', 'Default - Cyan', 'Default - Gold', 'Default - Grey', 'Default - Pink', 'Default - Red']);
    expect(f.styles[0]!.fontname).toBe('Squad Latin Black');
    expect(f.styles[0]!.marginV).toBe(525);
    expect(f.dialogue).toHaveLength(12);
    expect(f.dialogue[0]).toMatchObject({ style: 'Default - Grey', text: "Bro someone's" });
    expect(f.dialogue[11]!.end).toBeCloseTo(10.07);
  });

  it('round-trips colours and times', () => {
    expect(parseColour('&H00A59A00')).toEqual({ r: 0x00, g: 0x9a, b: 0xa5, a: 255 });
    expect(formatColour(parseColour('&H00A59A00'))).toBe('&H00A59A00');
    expect(formatColour(parseColour('&H80FF0000'))).toBe('&H80FF0000');
    expect(formatTime(parseTime('0:01:02.34'))).toBe('0:01:02.34');
  });

  it('writes a file that parses back to the same styles and lines', () => {
    const f = parseAss(sample);
    const out = writeAss({ styles: f.styles, cues: f.dialogue, playResX: f.playResX, playResY: f.playResY });
    const g = parseAss(out);
    expect(g.styles).toEqual(f.styles);
    expect(g.dialogue).toEqual(f.dialogue);
  });
});

describe('presets', () => {
  it('imports a preset from an .ass file and survives export/import', () => {
    const p = presetFromAss('Prisma', sample);
    expect(p.styles).toHaveLength(6);
    expect(importPreset(exportPreset(p))).toEqual(p);
  });

  it('rejects junk with a readable reason', () => {
    expect(() => importPreset('nope')).toThrow(PresetError);
    expect(() => importPreset('{"format":"x"}')).toThrow('Not a turbocut caption preset');
    const p = presetFromAss('P', sample);
    const bad = JSON.parse(exportPreset(p));
    bad.animation = { type: 'bounce', frames: 0, overshoot: 1.1 };
    expect(() => importPreset(JSON.stringify(bad))).toThrow('Invalid bounce settings');
  });
});

describe('bounce', () => {
  it('starts at 0, overshoots, settles at 1', () => {
    expect(bounce(0)).toBe(0);
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => bounce(i / 100)))).toBeCloseTo(1.15, 5);
    expect(bounce(1)).toBeCloseTo(1, 10);
  });

  it('matches ass_bounce.py frame for frame', () => {
    const py = execFileSync(
      'python3',
      ['-I', '-c', `
import re,sys
src=open(sys.argv[1]).read()
start=src.index('def bounce_scale'); end=src.index('# ----', start)
ns={}
exec(src[start:end], ns)
print(",".join(repr(ns['bounce_scale'](i/6)) for i in range(6)))
`, new URL('./fixtures/ass_bounce.py', import.meta.url).pathname],
      { encoding: 'utf8' },
    ).trim().split(',').map(Number);
    const ts = Array.from({ length: 6 }, (_, i) => entranceScale({ type: 'bounce', frames: 6, overshoot: 1.15 }, i));
    ts.forEach((v, i) => expect(v).toBeCloseTo(py[i]!, 12));
  });

  it('emits one scale segment per frame as ASS tags', () => {
    const tags = entranceTags({ type: 'bounce', frames: 6, overshoot: 1.15 }, 30);
    expect(tags.startsWith('\\fscx0\\fscy0')).toBe(true);
    expect(tags.match(/\\t\(/g)).toHaveLength(6);
    expect(tags.endsWith('\\fscx100\\fscy100)')).toBe(true);
    expect(entranceTags({ type: 'none' }, 30)).toBe('');
  });
});
