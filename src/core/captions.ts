import { newId } from './timeline.ts';
import type { CaptionCue, CaptionWord, Frame, Project } from './types.ts';

export const findCue = (p: Project, cueId: string): CaptionCue | undefined => p.captions.find((c) => c.id === cueId);

/** The cue showing at `frame`, if any. */
export const cueAt = (p: Project, frame: Frame): CaptionCue | undefined => p.captions.find((c) => frame >= c.start && frame < c.end);

/**
 * Which words go left of the cut. With word timings a word belongs to the side its middle falls on; without them
 * (a hand-typed caption or an imported .ass) the text is divided in proportion to where the cut falls in time.
 * Always leaves at least one word on each side, or returns null when there is only one word to share.
 */
function wordSplit(cue: CaptionCue, frame: Frame): { left: string[]; right: string[]; leftWords?: CaptionWord[]; rightWords?: CaptionWord[] } | null {
  if (cue.words && cue.words.length > 1) {
    const mid = (w: CaptionWord) => (w.start + w.end) / 2;
    let n = cue.words.filter((w) => mid(w) < frame).length;
    n = Math.min(cue.words.length - 1, Math.max(1, n));
    const leftWords = cue.words.slice(0, n);
    const rightWords = cue.words.slice(n);
    return { left: leftWords.map((w) => w.text), right: rightWords.map((w) => w.text), leftWords, rightWords };
  }
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const share = (frame - cue.start) / Math.max(1, cue.end - cue.start);
  // Divide by characters, so a long word takes the time it would take to say.
  const total = words.reduce((n, w) => n + w.length, 0);
  let acc = 0;
  let n = 0;
  for (const w of words) {
    if ((acc + w.length / 2) / total >= share) break;
    acc += w.length;
    n++;
  }
  n = Math.min(words.length - 1, Math.max(1, n));
  return { left: words.slice(0, n), right: words.slice(n) };
}

/**
 * Cut a caption in two at `frame`. The first half ends there and the second starts there. Returns the new second half,
 * or undefined when the frame is not inside the caption or the caption is a single word (nothing to share out).
 */
export function splitCue(p: Project, cueId: string, frame: Frame): CaptionCue | undefined {
  const cue = findCue(p, cueId);
  if (!cue || frame <= cue.start || frame >= cue.end) return;
  const parts = wordSplit(cue, frame);
  if (!parts) return;
  const right: CaptionCue = { id: newId('cue'), start: frame, end: cue.end, text: parts.right.join(' '), style: cue.style };
  cue.end = frame;
  cue.text = parts.left.join(' ');
  if (parts.leftWords && parts.rightWords) {
    cue.words = parts.leftWords;
    right.words = parts.rightWords;
  } else delete cue.words;
  p.captions.push(right);
  p.captions.sort((a, b) => a.start - b.start);
  return right;
}
