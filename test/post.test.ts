import { describe, expect, it } from 'vitest';
import { cleanWords } from '../src/transcribe/post.ts';

const w = (text: string, start: number, end: number) => ({ text, start, end });
/** 10 s of audio: loud for 0-4 s, silent 4-6 s, loud 6-10 s. */
const pcm = (() => {
  const a = new Float32Array(160000);
  for (let i = 0; i < a.length; i++) a[i] = i < 64000 || i >= 96000 ? 0.3 * Math.sin(i * 0.1) : 0;
  return a;
})();

describe('cleanWords', () => {
  it('drops words that start after the audio ended and clamps ends to it', () => {
    const r = cleanWords([w('hello', 9.5, 11), w('late', 10.2, 10.6), w('later', 14, 15)], { durationSec: 10 });
    expect(r.words.map((x) => x.text)).toEqual(['hello']);
    expect(r.words[0]!.end).toBe(10);
    expect(r.report.droppedPastEnd).toBe(2);
  });

  it('drops text invented over silence', () => {
    const r = cleanWords([w('real', 1, 1.5), w('Thanks', 4.5, 5), w('watching', 5, 5.5), w('again', 7, 7.4)], { durationSec: 10, pcm });
    expect(r.words.map((x) => x.text)).toEqual(['real', 'again']);
    expect(r.report.droppedSilent).toBe(2);
  });

  it('collapses a word repeated in a loop but keeps ordinary repeats', () => {
    const loop = Array.from({ length: 8 }, (_, i) => w('you', 1 + i * 0.3, 1.25 + i * 0.3));
    const r = cleanWords([w('no', 0.2, 0.5), w('no', 0.5, 0.8), ...loop], { durationSec: 10 });
    expect(r.words.filter((x) => x.text === 'you')).toHaveLength(3);
    expect(r.report.droppedRepeated).toBe(5);
    expect(r.words.filter((x) => x.text === 'no')).toHaveLength(2);
  });

  it('repairs inverted or zero-length timings, overlaps and order', () => {
    const r = cleanWords([w('b', 2, 2), w('a', 1, 2.5), w('!', 3, 3.1)], { durationSec: 10 });
    expect(r.words.map((x) => x.text)).toEqual(['a', 'b']);
    expect(r.words[0]!.end).toBeLessThanOrEqual(r.words[1]!.start);
    expect(r.words[1]!.end).toBeGreaterThan(r.words[1]!.start);
    expect(r.report.droppedEmpty).toBe(1);
  });
});
