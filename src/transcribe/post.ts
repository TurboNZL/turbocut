import type { TimedWord } from './provider.ts';

export interface CleanOptions {
  /** Length of the audio that was transcribed, in seconds. Nothing may start or end after it. */
  durationSec: number;
  /** The 16 kHz mono audio, so words that sit on silence can be recognised as invented. */
  pcm?: Float32Array;
  /** RMS below this over a word's span counts as silence. */
  silenceRms?: number;
  /** A word repeated more often than this in a row is a loop, not speech. */
  maxRepeats?: number;
}

export interface CleanReport {
  kept: number;
  droppedEmpty: number;
  droppedPastEnd: number;
  droppedSilent: number;
  droppedRepeated: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Whisper sometimes invents text: words timed after the audio ended, text over silence, and one word repeated
 * in a loop. Remove those, keep times inside the audio and in order, and report what was thrown away.
 */
export function cleanWords(input: TimedWord[], o: CleanOptions): { words: TimedWord[]; report: CleanReport } {
  const report: CleanReport = { kept: 0, droppedEmpty: 0, droppedPastEnd: 0, droppedSilent: 0, droppedRepeated: 0 };
  const silence = o.silenceRms ?? 0.003;
  const maxRepeats = o.maxRepeats ?? 3;
  const out: TimedWord[] = [];

  const rms = (a: number, b: number) => {
    if (!o.pcm) return Infinity;
    const i0 = Math.max(0, Math.floor(a * 16000));
    const i1 = Math.min(o.pcm.length, Math.max(i0 + 1, Math.ceil(b * 16000)));
    let sum = 0;
    for (let i = i0; i < i1; i++) sum += o.pcm[i]! * o.pcm[i]!;
    return Math.sqrt(sum / (i1 - i0));
  };

  const sorted = input
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ text: w.text.trim(), start: Math.max(0, w.start), end: w.end }))
    .sort((a, b) => a.start - b.start);

  let run = 0;
  let lastNorm = '';
  for (const w of sorted) {
    if (!norm(w.text)) {
      report.droppedEmpty++;
      continue;
    }
    if (w.start >= o.durationSec - 0.02) {
      report.droppedPastEnd++;
      continue;
    }
    w.end = Math.min(o.durationSec, w.end > w.start ? w.end : w.start + 0.15);
    if (rms(w.start, w.end) < silence) {
      report.droppedSilent++;
      continue;
    }
    const n = norm(w.text);
    run = n === lastNorm ? run + 1 : 1;
    lastNorm = n;
    if (run > maxRepeats) {
      report.droppedRepeated++;
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && prev.end > w.start) prev.end = Math.max(prev.start + 0.04, w.start); // timings from alignment can overlap
    out.push(w);
  }
  report.kept = out.length;
  return { words: out, report };
}
