import type { CaptionCue, CaptionWord } from '../core/types.ts';

/** 16 kHz mono float PCM, what Whisper models expect. Every provider takes this. */
export interface Pcm16k {
  samples: Float32Array<ArrayBuffer>;
  sampleRate: 16000;
}

export interface TranscribeOptions {
  language?: string; // ISO code, omit to auto-detect
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface TimedWord {
  text: string;
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
}

/**
 * One interface for the speech model. It runs on this device (Transformers.js + WebGPU inside the app: browser, Electron,
 * Android WebView); there is no remote option any more, so audio never leaves the device.
 */
export interface Transcriber {
  readonly id: string;
  readonly label: string;
  transcribe(audio: Pcm16k, opts?: TranscribeOptions): Promise<TimedWord[]>;
}

export interface GroupOptions {
  fps: number;
  /** Start a new caption after this many characters. */
  maxChars: number;
  /** ...or after this many words. */
  maxWords: number;
  /** ...or when the speaker pauses this long (seconds). */
  pause: number;
  /** ...or after a word that ends a sentence (. ! ? …). */
  sentences?: boolean;
}

/** Tall video: a few big words at a time. */
export const SHORTS_GROUPING: Omit<GroupOptions, 'fps'> = { maxChars: 18, maxWords: 4, pause: 0.35, sentences: true };
/** Wide video: a caption is a sentence (or most of one), at most about two lines. */
export const SENTENCE_GROUPING: Omit<GroupOptions, 'fps'> = { maxChars: 64, maxWords: 14, pause: 0.7, sentences: true };

/** The grouping a setting stands for. `auto` picks short lines for tall and square video and sentences for wide video. */
export function groupingFor(setting: 'auto' | 'short' | 'sentence', width: number, height: number): Omit<GroupOptions, 'fps'> {
  if (setting === 'short') return SHORTS_GROUPING;
  if (setting === 'sentence') return SENTENCE_GROUPING;
  return width > height ? SENTENCE_GROUPING : SHORTS_GROUPING;
}

const ENDS_SENTENCE = /[.!?…]["')\]]*$/;

/** Group word timings into short caption cues, the way vertical-video captions are normally shown. */
export function groupWords(words: TimedWord[], o: GroupOptions, style = 'Default'): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    const ws: CaptionWord[] = cur.map((w) => ({
      text: w.text.trim(),
      start: Math.round(w.start * o.fps),
      end: Math.max(Math.round(w.end * o.fps), Math.round(w.start * o.fps) + 1),
    }));
    cues.push({
      id: `cue_${cues.length}`,
      start: ws[0]!.start,
      end: ws[ws.length - 1]!.end,
      text: ws.map((w) => w.text).join(' '),
      style,
      words: ws,
    });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const len = cur.reduce((n, x) => n + x.text.trim().length + 1, 0) + w.text.trim().length;
    if (prev && (w.start - prev.end >= o.pause || cur.length >= o.maxWords || len > o.maxChars || (o.sentences && ENDS_SENTENCE.test(prev.text.trim())))) flush();
    cur.push(w);
  }
  flush();
  // Close tiny gaps so the caption does not flicker between words that follow each other.
  for (let i = 0; i < cues.length - 1; i++) {
    const a = cues[i]!;
    const b = cues[i + 1]!;
    if (b.start - a.end > 0 && b.start - a.end <= Math.round(o.fps * 0.1)) a.end = b.start;
  }
  return cues;
}
