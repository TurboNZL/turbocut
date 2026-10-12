import { bounce } from '../core/easing.ts';
import { parseAss, type AssStyle } from './ass.ts';

/**
 * A caption preset is a pack: one or more style variants (e.g. grey / red / cyan for different
 * speakers or emphasis) plus the entrance animation. It is plain JSON so it can be shared.
 */
export interface CaptionPreset {
  format: 'turbocut.captionPreset';
  version: 1;
  name: string;
  styles: AssStyle[];
  animation: EntranceAnimation;
}

export type EntranceAnimation =
  | { type: 'none' }
  | { type: 'bounce'; frames: number; overshoot: number };

export const DEFAULT_ANIMATION: EntranceAnimation = { type: 'bounce', frames: 6, overshoot: 1.15 };

export function exportPreset(p: CaptionPreset): string {
  return JSON.stringify(p, null, 2);
}

export class PresetError extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRgba = (c: any) => c && isNum(c.r) && isNum(c.g) && isNum(c.b) && isNum(c.a);

/** Parse and validate preset JSON. Throws PresetError with a readable reason. Never executes anything. */
export function importPreset(json: string): CaptionPreset {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new PresetError('Not valid JSON');
  }
  if (data?.format !== 'turbocut.captionPreset') throw new PresetError('Not a turbocut caption preset');
  if (data.version !== 1) throw new PresetError(`Unsupported preset version ${data.version}`);
  if (typeof data.name !== 'string' || !data.name) throw new PresetError('Preset has no name');
  if (!Array.isArray(data.styles) || data.styles.length === 0) throw new PresetError('Preset has no styles');
  for (const s of data.styles) {
    if (typeof s?.name !== 'string' || typeof s.fontname !== 'string' || !isNum(s.fontsize))
      throw new PresetError('A style is missing name, fontname or fontsize');
    if (!isRgba(s.primary) || !isRgba(s.outlineColour) || !isRgba(s.backColour))
      throw new PresetError(`Style "${s.name}" has an invalid colour`);
  }
  const a = data.animation;
  if (a?.type === 'bounce') {
    if (!isNum(a.frames) || a.frames < 1 || a.frames > 60 || !isNum(a.overshoot) || a.overshoot < 1 || a.overshoot > 3)
      throw new PresetError('Invalid bounce settings');
  } else if (a?.type !== 'none') throw new PresetError('Unknown animation type');
  return data as CaptionPreset;
}

/** Turn the styles of an existing .ass file (for example one exported from Kdenlive) into a preset. */
export function presetFromAss(name: string, assSource: string, animation: EntranceAnimation = DEFAULT_ANIMATION): CaptionPreset {
  const ass = parseAss(assSource);
  if (ass.styles.length === 0) throw new PresetError('The .ass file has no styles');
  return { format: 'turbocut.captionPreset', version: 1, name, styles: ass.styles, animation };
}

export function styleByName(p: CaptionPreset, name: string): AssStyle {
  return p.styles.find((s) => s.name === name) ?? p.styles[0]!;
}

/** Scale at normalised time `t` (0..1 across the entrance window) for canvas preview. */
export function entranceScale(a: EntranceAnimation, framesSinceStart: number): number {
  if (a.type === 'none' || framesSinceStart >= a.frames) return 1;
  return bounce(framesSinceStart / a.frames, a.overshoot);
}

/**
 * The same entrance as ASS override tags: one linear \t segment per frame, sampled from the exact
 * curve, so any ASS renderer (libass, ffmpeg's `ass` filter, players) reproduces it frame for frame.
 */
export function entranceTags(a: EntranceAnimation, fps: number): string {
  if (a.type === 'none') return '';
  const ms = 1000 / fps;
  let tags = '\\fscx0\\fscy0';
  for (let i = 0; i < a.frames; i++) {
    const s = Math.round((i + 1 < a.frames ? bounce((i + 1) / a.frames, a.overshoot) : 1) * 100);
    tags += `\\t(${Math.round(i * ms)},${Math.round((i + 1) * ms)},0,\\fscx${s}\\fscy${s})`;
  }
  return tags;
}
