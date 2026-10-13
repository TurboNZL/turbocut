import type { AssStyle } from '../captions/ass.ts';
import type { CaptionPreset } from '../captions/presets.ts';
import type { CounterMode } from './settings.ts';

export const BUILTIN_NAME = 'TurboCut Bounce';

const style = (name: string, fill: [number, number, number], font: string, counters: CounterMode): AssStyle => ({
  name,
  fontname: font,
  fontsize: 96,
  primary: { r: fill[0], g: fill[1], b: fill[2], a: 255 },
  outlineColour: { r: 0, g: 0, b: 0, a: 255 },
  backColour: { r: 0, g: 0, b: 0, a: 0 },
  bold: true,
  italic: false,
  outline: 9,
  shadow: 0,
  alignment: 2,
  marginL: 40,
  marginR: 40,
  marginV: 480,
  counters,
});

/**
 * The style that ships with TurboCut. It uses the default font and letter-hole style from the settings, so changing
 * those changes this style too. It ships no font files: it falls back to a bold sans-serif until a font is added.
 */
export function builtinPreset(font: string, counters: CounterMode): CaptionPreset {
  return {
    format: 'turbocut.captionPreset',
    version: 1,
    name: BUILTIN_NAME,
    builtin: true,
    styles: [
      style('Default', [255, 255, 255], font, counters),
      style('Default - Yellow', [255, 214, 10], font, counters),
      style('Default - Red', [255, 69, 58], font, counters),
      style('Default - Cyan', [10, 220, 255], font, counters),
      style('Default - Grey', [190, 190, 190], font, counters),
    ],
    animation: { type: 'bounce', frames: 6, overshoot: 1.15 },
  };
}
