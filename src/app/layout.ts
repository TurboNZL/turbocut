/**
 * Editor layouts: where the side panel sits, how big it and the timeline are, how large the controls are, and which
 * panel tabs show and in what order. A few ship built in; people save their own, and share them as small JSON files.
 * Pure data and validation here; `main.ts` applies the result to the page.
 */
export const TAB_NAMES = ['Clip', 'Media', 'Captions', 'Project', 'Settings'] as const;
export type TabName = (typeof TAB_NAMES)[number];
/** The tabs every layout offered before Settings could be a tab: a saved layout without a pane for Settings still opens the Settings window. */
const CORE_TABS: TabName[] = ['Clip', 'Media', 'Captions', 'Project'];

export type PanelPlacement = 'auto' | 'right' | 'left' | 'sheet';
export type Density = 'auto' | 'compact' | 'normal' | 'large';
/** Where Split, Trim and the other editing tools sit: above the timeline, under it, or by device (above with a mouse, under on a phone). */
export type ToolsPlacement = 'auto' | 'top' | 'bottom';

export const MAX_PANES = 3;

export interface Layout {
  name: string;
  /** auto: a right-hand panel on a wide mouse screen, a bottom sheet on a phone or narrow window. */
  panel: PanelPlacement;
  /** Width of a side panel in pixels. */
  panelWidth: number;
  /** Share of the window height given to the timeline, in percent. */
  timelineHeight: number;
  /** auto: large touch targets on a phone, normal elsewhere. */
  density: Density;
  /** The side panel as one to three panes, top to bottom; each pane lists its own tabs in order. A tab in no pane is hidden. */
  panes: TabName[][];
  /** Height of each pane in percent of the panel (sums to 100). */
  paneSizes: number[];
  tools: ToolsPlacement;
  /** The tabs are in a dock along the bottom of the window (like the bottom dock of TurboKeep) instead of a strip on each pane. */
  dock: boolean;
}

export const AUTO_LAYOUT = 'Automatic';

const base = (over: Partial<Layout> & { name: string }): Layout => ({
  panel: 'auto',
  panelWidth: 340,
  timelineHeight: 34,
  density: 'auto',
  panes: [[...CORE_TABS]],
  paneSizes: [100],
  tools: 'auto',
  dock: false,
  ...over,
});

export const BUILTIN_LAYOUTS: Layout[] = [
  base({ name: AUTO_LAYOUT }),
  base({ name: 'Panel on the left', panel: 'left' }),
  base({ name: 'Tall timeline', panel: 'right', timelineHeight: 50 }),
  base({ name: 'Bottom sheet', panel: 'sheet' }),
  base({ name: 'Compact', panel: 'right', panelWidth: 280, timelineHeight: 30, density: 'compact' }),
  base({ name: 'Large controls', panelWidth: 380, timelineHeight: 38, density: 'large' }),
  base({ name: 'Two panels', panel: 'right', panelWidth: 360, panes: [['Clip'], ['Media', 'Captions', 'Project']], paneSizes: [50, 50] }),
  base({ name: 'Three panels', panel: 'right', panelWidth: 360, panes: [['Clip'], ['Media'], ['Captions', 'Project']], paneSizes: [34, 33, 33] }),
  base({ name: 'Bottom dock', panel: 'right', panes: [[...CORE_TABS, 'Settings']], dock: true }),
];

export const LIMITS = { panelWidth: [240, 640], timelineHeight: [20, 70], paneSize: [15, 70] } as const;
const clamp = (v: number, [lo, hi]: readonly [number, number] | readonly number[]) => Math.min(hi!, Math.max(lo!, Math.round(v)));

/** Panes of equal height, or the given sizes made to add up to 100 (and none below the minimum). */
export function normalizeSizes(sizes: unknown, n: number): number[] {
  const given = Array.isArray(sizes) && sizes.length === n && sizes.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0) ? (sizes as number[]) : null;
  if (!given) {
    const each = Math.floor(100 / n);
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - each * (n - 1) : each));
  }
  const total = given.reduce((a, b) => a + b, 0);
  let out = given.map((x) => Math.max(LIMITS.paneSize[0], Math.round((x / total) * 100)));
  const diff = 100 - out.reduce((a, b) => a + b, 0);
  out[out.length - 1]! += diff; // rounding goes to the last pane
  if (out.some((x) => x < LIMITS.paneSize[0])) out = normalizeSizes(null, n);
  return out;
}

/** Every tab a layout shows, in order. */
export const layoutTabs = (l: Layout): TabName[] => l.panes.flat();

/** A usable layout from anything: wrong types and out-of-range numbers are repaired, unknown tabs dropped, at least one tab kept. */
export function cleanLayout(raw: unknown, fallback: Layout = BUILTIN_LAYOUTS[0]!): Layout | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  const panel: PanelPlacement = r.panel === 'right' || r.panel === 'left' || r.panel === 'sheet' || r.panel === 'auto' ? r.panel : fallback.panel;
  const density: Density = r.density === 'compact' || r.density === 'normal' || r.density === 'large' || r.density === 'auto' ? r.density : fallback.density;
  const tools: ToolsPlacement = r.tools === 'top' || r.tools === 'bottom' || r.tools === 'auto' ? r.tools : fallback.tools;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const seen = new Set<string>();
  // The Keys tab was merged into Clip: a saved layout that still lists it keeps its place as Clip.
  const known = (t: unknown): t is TabName => (TAB_NAMES as readonly string[]).includes(t as string) && !seen.has(t as string) && !!seen.add(t as string);
  // Older layouts have one flat list of tabs: that is one pane.
  const rawPanes: unknown[] = Array.isArray(r.panes) ? r.panes : Array.isArray(r.tabs) ? [r.tabs] : [];
  const panes = rawPanes
    .map((p) => (Array.isArray(p) ? p.map((t) => (t === 'Keys' ? 'Clip' : t)).filter(known) : []))
    .filter((p) => p.length > 0)
    .slice(0, MAX_PANES);
  const useFallback = panes.length === 0;
  const finalPanes = useFallback ? fallback.panes.map((p) => [...p]) : panes;
  return {
    name: r.name.trim().slice(0, 40),
    panel,
    panelWidth: clamp(num(r.panelWidth, fallback.panelWidth), LIMITS.panelWidth),
    timelineHeight: clamp(num(r.timelineHeight, fallback.timelineHeight), LIMITS.timelineHeight),
    density,
    panes: finalPanes,
    paneSizes: normalizeSizes(useFallback ? fallback.paneSizes : r.paneSizes, finalPanes.length),
    tools,
    dock: typeof r.dock === 'boolean' ? r.dock : fallback.dock,
  };
}

/** What the page needs to draw a layout on this screen. */
export interface AppliedLayout {
  panel: 'right' | 'left' | 'sheet';
  panelWidth: number;
  timelineHeight: number;
  density: 'compact' | 'normal' | 'large';
  panes: TabName[][];
  paneSizes: number[];
  tools: 'top' | 'bottom';
  dock: boolean;
}

export function applyLayout(l: Layout, narrow: boolean, touch: boolean): AppliedLayout {
  // A side panel cannot work on a narrow screen: the preview would be crushed, so it becomes the sheet (and its panes become one).
  const wanted = l.panel === 'auto' ? 'right' : l.panel;
  const panel = narrow || l.panel === 'sheet' ? 'sheet' : wanted;
  const flat = panel === 'sheet';
  return {
    panel,
    panelWidth: l.panelWidth,
    timelineHeight: l.timelineHeight,
    density: l.density === 'auto' ? (touch ? 'large' : 'normal') : l.density,
    panes: flat ? [layoutTabs(l)] : l.panes,
    paneSizes: flat ? [100] : l.paneSizes,
    tools: l.tools === 'auto' ? (touch || narrow ? 'bottom' : 'top') : l.tools,
    dock: l.dock,
  };
}

export function exportLayout(l: Layout): string {
  return JSON.stringify({ format: 'turbocut.layout', version: 2, layout: l }, null, 2);
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
