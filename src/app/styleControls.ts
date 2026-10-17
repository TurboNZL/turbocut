import type { AssStyle, Rgba } from '../captions/ass.ts';
import { h } from './dom.ts';
import { fontChoices } from './fonts.ts';

const hex = (c: Rgba) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string, alpha: number): Rgba => ({ r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16), a: alpha });

export interface StyleControlOptions {
  /** Called after every change, with the style already updated in place. */
  onChange: () => void;
  /** Called at the start of a burst of edits (one undo step). */
  onBegin?: () => void;
  /** Alignment and margins matter for captions (where they sit on screen) but not for text layers (positioned with X and Y). */
  placement?: boolean;
  /** Font names offered in the list. */
  fonts?: string[];
}

const row = (label: string, ...controls: HTMLElement[]) => h('label', { class: 'prop style-row' }, h('span', { class: 'prop-l' }, label), ...controls);

/**
 * Compact editor for one text style: font, size, bold/italic, fill and outline colour, outline width, what the
 * holes of letters look like, and (for captions) alignment and margins. Edits the style object directly.
 */
export function styleControls(style: AssStyle, o: StyleControlOptions): HTMLElement {
  let burst = false;
  const begin = () => {
    if (!burst) {
      o.onBegin?.();
      burst = true;
    }
  };
  const commit = () => o.onChange();
  const done = () => (burst = false);

  const listId = `fonts-${Math.random().toString(36).slice(2, 7)}`;
  const list = h('datalist', { id: listId }, ...(o.fonts ?? fontChoices()).map((f) => h('option', { value: f })));
  const font = h('input', { class: 'input', list: listId, value: style.fontname, 'aria-label': 'Font' });
  font.addEventListener('input', () => ((begin(), (style.fontname = font.value.trim() || style.fontname)), commit()));
  font.addEventListener('change', done);

  const num = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step = 1) => {
    const input = h('input', { type: 'number', class: 'input num', min, max, step, value: get(), 'aria-label': label });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      begin();
      set(Math.min(max, Math.max(min, v)));
      commit();
    });
    input.addEventListener('change', done);
    return row(label, input);
  };

  const colour = (label: string, get: () => Rgba, set: (c: Rgba) => void) => {
    const input = h('input', { type: 'color', class: 'colour', value: hex(get()), 'aria-label': label });
    input.addEventListener('input', () => {
      begin();
      set(fromHex(input.value, get().a));
      commit();
    });
    input.addEventListener('change', done);
    return row(label, input);
  };

  const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const box = h('input', { type: 'checkbox', checked: get(), 'aria-label': label });
    box.addEventListener('change', () => {
      begin();
      set(box.checked);
      commit();
      done();
    });
    return h('label', { class: 'setting' }, box, h('span', {}, label));
  };

  const counters = h('select', { class: 'input', 'aria-label': 'Letter holes' },
    ...([['filled', 'Filled'], ['rim', 'Thin rim'], ['clear', 'Clear']] as const).map(([v, l]) => h('option', { value: v, selected: (style.counters ?? 'filled') === v }, l)));
  counters.addEventListener('change', () => {
    begin();
    style.counters = counters.value as AssStyle['counters'];
    commit();
    done();
  });

  const parts: HTMLElement[] = [
    row('Font', font), list,
    num('Size', () => style.fontsize, (v) => (style.fontsize = v), 8, 600),
    h('div', { class: 'row' }, check('Bold', () => style.bold, (v) => (style.bold = v)), check('Italic', () => style.italic, (v) => (style.italic = v))),
    colour('Fill', () => style.primary, (c) => (style.primary = c)),
    colour('Outline', () => style.outlineColour, (c) => (style.outlineColour = c)),
    num('Outline width', () => style.outline, (v) => (style.outline = v), 0, 60),
    row('Letter holes', counters),
  ];
  if (o.placement) {
    const align = h('select', { class: 'input', 'aria-label': 'Alignment' },
      ...([[2, 'Bottom centre'], [5, 'Middle centre'], [8, 'Top centre'], [1, 'Bottom left'], [3, 'Bottom right'], [7, 'Top left'], [9, 'Top right']] as [number, string][]).map(([v, l]) => h('option', { value: String(v), selected: style.alignment === v }, l)));
    align.addEventListener('change', () => {
      begin();
      style.alignment = Number(align.value);
      commit();
      done();
    });
    parts.push(row('Position', align), num('Distance from edge', () => style.marginV, (v) => (style.marginV = v), 0, 1800), num('Side margins', () => style.marginL, (v) => ((style.marginL = v), (style.marginR = v)), 0, 500));
  }
  return h('div', { class: 'style-controls' }, ...parts);
}
