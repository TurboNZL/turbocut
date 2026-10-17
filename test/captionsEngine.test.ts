import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/app/settings.ts';
import { ACCURATE_MODEL, BALANCED_MODEL, MODEL_CHOICES, MODELS, recommendedModel } from '../src/transcribe/local.ts';
import { groupingFor, groupWords, SENTENCE_GROUPING, SHORTS_GROUPING } from '../src/transcribe/provider.ts';

const say = (s: string) => s.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.3 }));

describe('speech model choice', () => {
  it('recommends the accurate model on a computer and the balanced one on a phone', () => {
    expect(recommendedModel(false)).toBe(ACCURATE_MODEL);
    expect(recommendedModel(true)).toBe(BALANCED_MODEL);
    expect(DEFAULT_SETTINGS(false).transcribe.model).toBe(ACCURATE_MODEL);
    expect(DEFAULT_SETTINGS(true).transcribe.model).toBe(BALANCED_MODEL);
    expect(DEFAULT_SETTINGS(false).transcribe.modelChosen).toBe(false);
  });

  it('offers only models the engine knows', () => {
    const known = new Set(MODELS.map((m) => m.id as string));
    for (const c of MODEL_CHOICES) expect(known.has(c.id)).toBe(true);
    expect(MODEL_CHOICES.map((c) => c.id)).toContain(ACCURATE_MODEL);
  });

  it('settings saved by an older version: the old default is replaced and asked about, a real choice is kept', () => {
    const d = DEFAULT_SETTINGS(false);
    const old = mergeSettings({ transcribe: { mode: 'local', model: BALANCED_MODEL, lang: 'english', compute: 'auto', url: '', token: '' } }, d);
    expect(old.transcribe.model).toBe(ACCURATE_MODEL);
    expect(old.transcribe.modelChosen).toBe(false);
    const fast = mergeSettings({ transcribe: { model: 'onnx-community/whisper-tiny.en_timestamped' } }, d);
    expect(fast.transcribe.model).toBe('onnx-community/whisper-tiny.en_timestamped');
    expect(fast.transcribe.modelChosen).toBe(true);
    const chosen = mergeSettings({ transcribe: { model: BALANCED_MODEL, modelChosen: true } }, d);
    expect(chosen.transcribe.model).toBe(BALANCED_MODEL);
    expect(chosen.transcribe.modelChosen).toBe(true);
  });

  it('keeps only a valid caption length', () => {
    const d = DEFAULT_SETTINGS(false);
    expect(mergeSettings({ transcribe: { grouping: 'sentence' } }, d).transcribe.grouping).toBe('sentence');
    expect(mergeSettings({ transcribe: { grouping: 'nonsense' } }, d).transcribe.grouping).toBe('auto');
  });
});

describe('caption length', () => {
  it('auto picks short lines for tall video and sentences for wide video', () => {
    expect(groupingFor('auto', 1080, 1920)).toBe(SHORTS_GROUPING);
    expect(groupingFor('auto', 1080, 1080)).toBe(SHORTS_GROUPING);
    expect(groupingFor('auto', 1920, 1080)).toBe(SENTENCE_GROUPING);
    expect(groupingFor('sentence', 1080, 1920)).toBe(SENTENCE_GROUPING);
    expect(groupingFor('short', 1920, 1080)).toBe(SHORTS_GROUPING);
  });

  it('sentence captions hold a whole sentence instead of four words', () => {
    const words = [...say('So today we are going to talk about how this works.'), ...say('It is simple.').map((w) => ({ ...w, start: w.start + 6, end: w.end + 6 }))];
    const short = groupWords(words, { fps: 30, ...SHORTS_GROUPING });
    const long = groupWords(words, { fps: 30, ...SENTENCE_GROUPING });
    expect(short.length).toBeGreaterThan(3);
    expect(long.map((c) => c.text)).toEqual(['So today we are going to talk about how this works.', 'It is simple.']);
  });

  it('starts a new caption after a sentence ends, even when the speaker does not pause', () => {
    const words = [{ text: 'Stop.', start: 0, end: 0.3 }, { text: 'Go', start: 0.32, end: 0.6 }];
    expect(groupWords(words, { fps: 30, ...SHORTS_GROUPING }).map((c) => c.text)).toEqual(['Stop.', 'Go']);
    expect(groupWords(words, { fps: 30, maxChars: 40, maxWords: 8, pause: 1 }).map((c) => c.text)).toEqual(['Stop. Go']);
  });
});
