import { entranceScale, styleByName, type CaptionPreset } from '../captions/presets.ts';
import type { AssStyle } from '../captions/ass.ts';
import type { Frame, Project } from '../core/types.ts';
import type { Ctx2D } from './compose.ts';
import { rasterizeText, type TextRaster } from './outlinedText.ts';

const css = (c: { r: number; g: number; b: number; a: number }) => `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;

/** Greedy word wrap. `width` measures a string; a single word longer than `max` stays on its own line. */
export function wrapText(text: string, max: number, width: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > max) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** The caption cue showing at `frame`, plus how many frames it has been on screen. */
export function activeCue(p: Project, frame: Frame) {
  for (const cue of p.captions) if (frame >= cue.start && frame < cue.end) return { cue, age: frame - cue.start };
}

function anchor(style: AssStyle, w: number, h: number) {
  const col = (style.alignment - 1) % 3; // 0 left, 1 centre, 2 right
  const row = Math.floor((style.alignment - 1) / 3); // 0 bottom, 1 middle, 2 top
  const x = col === 0 ? style.marginL : col === 1 ? w / 2 : w - style.marginR;
  const y = row === 0 ? h - style.marginV : row === 1 ? h / 2 : style.marginV;
  return { x, y, align: (['left', 'center', 'right'] as const)[col]!, base: (['bottom', 'middle', 'top'] as const)[row]! };
}

const cache = new Map<string, TextRaster>();

/** Draw the caption for `frame` with the preset's style and entrance animation. */
export function drawCaption(ctx: Ctx2D, p: Project, preset: CaptionPreset, frame: Frame): void {
  const hit = activeCue(p, frame);
  if (!hit) return;
  const style = styleByName(preset, hit.cue.style);
  const s = entranceScale(preset.animation, hit.age);
  if (s <= 0) return;
  const a = anchor(style, p.width, p.height);
  const lh = style.fontsize * 1.2;
  const fontFor = (px: number) => `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${px}px "${style.fontname}", sans-serif`;

  // Wrap to the safe width at full size, like ASS does (WrapStyle 0), so a long caption never runs off the frame.
  const probe = ctx;
  probe.save();
  probe.font = fontFor(style.fontsize);
  const maxWidth = Math.max(40, p.width - style.marginL - style.marginR);
  const lines = wrapText(hit.cue.text, maxWidth, (t) => probe.measureText(t).width);
  probe.restore();

  // The text is rasterised at its animated size (crisp at every step of the bounce) and cached.
  const q = Math.round(s * 100) / 100;
  const key = JSON.stringify([lines, fontFor(style.fontsize), q, style.outline, style.primary, style.outlineColour, style.counters, a.align, a.base, document.fonts?.size ?? 0]);
  let raster = cache.get(key);
  if (!raster) {
    raster = rasterizeText({
      lines,
      font: fontFor(style.fontsize * q),
      fontSize: style.fontsize * q,
      lineHeight: lh * q,
      align: a.align,
      baseline: a.base === 'bottom' ? 'alphabetic' : a.base === 'top' ? 'top' : 'middle',
      fill: style.primary,
      outline: style.outlineColour,
      outlineWidth: style.outline * q,
      counters: style.counters,
    });
    if (cache.size > 80) cache.delete(cache.keys().next().value!);
    cache.set(key, raster);
  }
  const block = (lines.length - 1) * lh * q;
  // The bitmap's anchor is the first line's origin: shift up so the last line (bottom) or the middle sits on the anchor.
  const top = a.y - (a.base === 'bottom' ? block : a.base === 'middle' ? block / 2 : 0);
  ctx.drawImage(raster.canvas, a.x - raster.ox, top - raster.oy);
}
