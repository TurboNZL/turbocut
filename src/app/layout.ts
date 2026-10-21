/**
 * Editor layouts: where the panels sit, how big they and the timeline are, how large the controls are, and where the editing
 * tools go. A layout is a list of named **divisions** (panels): each one is its own box with its own name and tabs, on the left or
 * the right of the preview, stacked in a column when several share a side. A few ship built in; people save their own and share
 * them as small JSON files. Pure data and validation here; `main.ts` applies the result to the page.
 */
export const TAB_NAMES = ['Clip', 'Media', 'Captions', 'Project'] as const;
export type TabName = (typeof TAB_NAMES)[number];

/** `auto` is a side panel on a wide screen and a bottom sheet on a phone or narrow window; `sheet` always uses the sheet. */
export type PanelPlacement = 'auto' | 'sheet';
export type Density = 'auto' | 'compact' | 'normal' | 'large';
/**
 * Where Split, Trim and the other editing tools sit. `auto`: in line with the play button on a computer, under the timeline on a
 * phone. `top`: in line with the play button, or on a phone in a row just under it (above the panel). `row`: always a row of their
 * own under the play button. `bottom`: under the timeline. `left` / `right`: a column beside the preview (a phone has no room for one
 * and uses `bottom`). `float`: round buttons floating at the bottom right of the screen.
 */
export type ToolsPlacement = 'auto' | 'top' | 'row' | 'bottom' | 'left' | 'right' | 'float';
const TOOLS_PLACEMENTS: readonly string[] = ['auto', 'top', 'row', 'bottom', 'left', 'right', 'float'];
export type Side = 'left' | 'right';

export const MAX_DIVISIONS = 6;

export interface Division {
  /** What the person calls this panel. */
  name: string;
  side: Side;
  tabs: TabName[];
  /** Height in percent of its column (the divisions of one side add up to 100). */
  size: number;
}

export interface Layout {
  name: string;
  panel: PanelPlacement;
  /** Width of the right-hand column in pixels. */
  panelWidth: number;
  /** Width of the left-hand column in pixels. */
  leftWidth: number;
  /** Share of the window height given to the timeline, in percent. */
  timelineHeight: number;
  /** auto: large touch targets on a phone, normal elsewhere. */
  density: Density;
  divisions: Division[];
  tools: ToolsPlacement;
}

export const AUTO_LAYOUT = 'Automatic';

const div = (name: string, side: Side, tabs: TabName[], size = 100): Division => ({ name, side, tabs, size });

const base = (over: Partial<Layout> & { name: string }): Layout => ({
  panel: 'auto',
  panelWidth: 340,
  leftWidth: 300,
  timelineHeight: 34,
  density: 'auto',
  divisions: [div('Panel', 'right', [...TAB_NAMES])],
  tools: 'auto',
  ...over,
});

/** Four presets. Anything else is made by changing one of them: the change is saved as the person's own layout. */
export const BUILTIN_LAYOUTS: Layout[] = [
  base({ name: AUTO_LAYOUT }),
  base({ name: 'Library and editor', divisions: [div('Library', 'left', ['Media', 'Project']), div('Editor', 'right', ['Clip', 'Captions'])] }),
  base({ name: 'Stacked panels', panelWidth: 360, divisions: [div('Editor', 'right', ['Clip', 'Captions'], 55), div('Library', 'right', ['Media', 'Project'], 45)] }),
  base({ name: 'Bottom sheet', panel: 'sheet' }),
];

export const LIMITS = { panelWidth: [240, 640], timelineHeight: [20, 70], paneSize: [15, 85] } as const;
const clamp = (v: number, [lo, hi]: readonly [number, number] | readonly number[]) => Math.min(hi!, Math.max(lo!, Math.round(v)));

/** Heights that add up to 100 and none below the minimum; equal heights when the given ones do not fit. */
export function normalizeSizes(sizes: unknown, n: number): number[] {
  const given = Array.isArray(sizes) && sizes.length === n && sizes.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0) ? (sizes as number[]) : null;
  if (!given) {
    const each = Math.floor(100 / n);
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - each * (n - 1) : each));
  }
  const total = given.reduce((a, b) => a + b, 0);
  let out = given.map((x) => Math.max(LIMITS.paneSize[0], Math.round((x / total) * 100)));
  const diff = 100 - out.reduce((a, b) => a + b, 0);
  out[out.length - 1]! += diff; // rounding goes to the last one
  if (out.some((x) => x < LIMITS.paneSize[0])) out = normalizeSizes(null, n);
  return out;
}

/** The divisions of one side, top to bottom. */
export const column = (l: { divisions: Division[] }, side: Side): Division[] => l.divisions.filter((d) => d.side === side);

/** Every tab a layout shows, in order (left column first). */
export const layoutTabs = (l: { divisions: Division[] }): TabName[] => [...column(l, 'left'), ...column(l, 'right')].flatMap((d) => d.tabs);

/** Make each side's sizes add up to 100. */
function fixSizes(divs: Division[]): Division[] {
  for (const side of ['left', 'right'] as const) {
    const col = divs.filter((d) => d.side === side);
    if (!col.length) continue;
    const sizes = normalizeSizes(col.map((d) => d.size), col.length);
    col.forEach((d, i) => (d.size = sizes[i]!));
  }
  return divs;
}

export function uniqueDivisionName(wanted: string, divs: Division[], except?: Division): string {
  const taken = new Set(divs.filter((d) => d !== except).map((d) => d.name.toLowerCase()));
  const name = wanted.trim().slice(0, 24) || 'Panel';
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
}

/** A usable layout from anything: wrong types and out-of-range numbers are repaired, unknown tabs dropped, at least one tab kept. */
export function cleanLayout(raw: unknown, fallback: Layout = BUILTIN_LAYOUTS[0]!): Layout | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  const legacySide: Side = r.panel === 'left' ? 'left' : 'right';
  const panel: PanelPlacement = r.panel === 'sheet' ? 'sheet' : r.panel === 'auto' ? 'auto' : r.panel === 'left' || r.panel === 'right' ? 'auto' : fallback.panel;
  const density: Density = r.density === 'compact' || r.density === 'normal' || r.density === 'large' || r.density === 'auto' ? r.density : fallback.density;
  const tools: ToolsPlacement = TOOLS_PLACEMENTS.includes(r.tools as string) ? (r.tools as ToolsPlacement) : fallback.tools;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const seen = new Set<string>();
  const known = (t: unknown): t is TabName => (TAB_NAMES as readonly string[]).includes(t as string) && !seen.has(t as string) && !!seen.add(t as string);
  // Layouts saved before divisions: `panes` (lists of tabs, all on one side) or a flat `tabs` list. The old Keys tab became Clip; Settings is no longer a tab.
  const oldPanes: unknown[] = Array.isArray(r.panes) ? r.panes : Array.isArray(r.tabs) ? [r.tabs] : [];
  const rawDivs: { name: unknown; side: unknown; tabs: unknown; size: unknown }[] = Array.isArray(r.divisions)
    ? (r.divisions as any[]).filter((d) => d && typeof d === 'object')
    : oldPanes.map((p, i) => ({ name: oldPanes.length > 1 ? `Panel ${i + 1}` : 'Panel', side: legacySide, tabs: p, size: Array.isArray(r.paneSizes) ? (r.paneSizes as unknown[])[i] : undefined }));
  const divisions: Division[] = [];
  for (const d of rawDivs) {
    const tabs = (Array.isArray(d.tabs) ? d.tabs : []).map((t) => (t === 'Keys' ? 'Clip' : t)).filter(known);
    if (!tabs.length || divisions.length >= MAX_DIVISIONS) continue;
    const side: Side = d.side === 'left' ? 'left' : 'right';
    divisions.push({ name: uniqueDivisionName(typeof d.name === 'string' ? d.name : 'Panel', divisions), side, tabs, size: num(d.size, 0) });
  }
  const useFallback = divisions.length === 0;
  const finalDivs = fixSizes(useFallback ? structuredClone(fallback.divisions) : divisions);
  return {
    name: r.name.trim().slice(0, 40),
    panel,
    panelWidth: clamp(num(r.panelWidth, fallback.panelWidth), LIMITS.panelWidth),
    leftWidth: clamp(num(r.leftWidth, fallback.leftWidth), LIMITS.panelWidth),
    timelineHeight: clamp(num(r.timelineHeight, fallback.timelineHeight), LIMITS.timelineHeight),
    density,
    divisions: finalDivs,
    tools,
  };
}

/** What the page needs to draw a layout on this screen. */
export interface AppliedLayout {
  /** `side`: columns beside the preview; `sheet`: one panel under the timeline. */
  mode: 'side' | 'sheet';
  panelWidth: number;
  leftWidth: number;
  timelineHeight: number;
  density: 'compact' | 'normal' | 'large';
  left: Division[];
  right: Division[];
  /** `inline`: in the transport row; `stage`: a row under it; `bottom`: under the timeline; `left` / `right`: a column beside the preview; `float`: round buttons at the bottom right. */
  tools: 'inline' | 'stage' | 'bottom' | 'left' | 'right' | 'float';
}

export function applyLayout(l: Layout, narrow: boolean, touch: boolean): AppliedLayout {
  // Side panels cannot work on a narrow screen: the preview would be crushed, so everything becomes one sheet.
  const sheet = narrow || l.panel === 'sheet';
  const phone = narrow || touch;
  const flat: Division = { name: 'Panel', side: 'right', tabs: layoutTabs(l), size: 100 };
  return {
    mode: sheet ? 'sheet' : 'side',
    panelWidth: l.panelWidth,
    leftWidth: l.leftWidth,
    timelineHeight: l.timelineHeight,
    density: l.density === 'auto' ? (touch ? 'large' : 'normal') : l.density,
    left: sheet ? [] : column(l, 'left'),
    right: sheet ? [flat] : column(l, 'right'),
    tools: l.tools === 'bottom' || l.tools === 'float' ? l.tools : l.tools === 'row' ? 'stage' : l.tools === 'left' || l.tools === 'right' ? (phone ? 'bottom' : l.tools) : l.tools === 'top' ? (phone ? 'stage' : 'inline') : phone ? 'bottom' : 'inline',
  };
}

export function exportLayout(l: Layout): string {
  return JSON.stringify({ format: 'turbocut.layout', version: 3, layout: l }, null, 2);
}

export function importLayout(json: string): Layout {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not valid JSON');
  }
  if (data?.format !== 'turbocut.layout') throw new Error('Not a TurboCut layout');
  const l = cleanLayout(data.layout);
  if (!l) throw new Error('The layout has no name');
  return l;
}

/** The chosen layout by name, among the built-in and the person's own. Falls back to Automatic. */
export function findLayout(name: string, custom: Layout[]): Layout {
  return custom.find((l) => l.name === name) ?? BUILTIN_LAYOUTS.find((l) => l.name === name) ?? BUILTIN_LAYOUTS[0]!;
}

export function uniqueLayoutName(base: string, custom: Layout[]): string {
  const taken = new Set([...BUILTIN_LAYOUTS, ...custom].map((l) => l.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}
