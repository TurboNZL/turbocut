import { entranceScale, styleByName, type CaptionPreset } from '../captions/presets.ts';
import type { AssStyle } from '../captions/ass.ts';
import type { Frame, Project } from '../core/types.ts';
import type { Ctx2D } from './compose.ts';

const css = (c: { r: number; g: number; b: number; a: number }) => `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;

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

/** Draw the caption for `frame` with the preset's style and entrance animation. */
export function drawCaption(ctx: Ctx2D, p: Project, preset: CaptionPreset, frame: Frame): void {
  const hit = activeCue(p, frame);
  if (!hit) return;
  const style = styleByName(preset, hit.cue.style);
  const s = entranceScale(preset.animation, hit.age);
  if (s <= 0) return;
  const a = anchor(style, p.width, p.height);
  const lines = hit.cue.text.split('\n');
  const lh = style.fontsize * 1.2;

  ctx.save();
  ctx.translate(a.x, a.y - (a.base === 'bottom' ? (lines.length - 1) * lh : 0));
  ctx.scale(s, s);
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${style.fontsize}px "${style.fontname}", sans-serif`;
  ctx.textAlign = a.align;
  ctx.textBaseline = a.base === 'bottom' ? 'alphabetic' : a.base === 'top' ? 'top' : 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  lines.forEach((line, i) => {
    const y = i * lh;
    if (style.outline > 0) {
      ctx.lineWidth = style.outline * 2; // ASS outline is the visible width outside the glyph; the stroke is centred
      ctx.strokeStyle = css(style.outlineColour);
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = css(style.primary);
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}
