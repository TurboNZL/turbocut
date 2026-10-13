import type { CaptionPreset } from '../captions/presets.ts';
import type { AssStyle } from '../captions/ass.ts';

const style = (name: string, fill: [number, number, number]): AssStyle => ({
  name,
  fontname: 'Arial Black',
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
});

/** Ships with TurboCut: no third-party font files, so it renders everywhere (falls back to a bold sans-serif). */
export const BUILTIN_PRESET: CaptionPreset = {
  format: 'turbocut.captionPreset',
  version: 1,
  name: 'TurboCut Bounce',
  styles: [
    style('Default', [255, 255, 255]),
    style('Default - Yellow', [255, 214, 10]),
    style('Default - Red', [255, 69, 58]),
    style('Default - Cyan', [10, 220, 255]),
    style('Default - Grey', [190, 190, 190]),
  ],
  animation: { type: 'bounce', frames: 6, overshoot: 1.15 },
};
