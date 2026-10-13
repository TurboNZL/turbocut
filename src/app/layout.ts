/**
 * Editor layouts: where the side panel sits, how big it and the timeline are, how large the controls are, and which
 * panel tabs show and in what order. A few ship built in; people save their own, and share them as small JSON files.
 * Pure data and validation here; `main.ts` applies the result to the page.
 */
export const TAB_NAMES = ['Clip', 'Keys', 'Media', 'Captions', 'Project'] as const;
export type TabName = (typeof TAB_NAMES)[number];

export type PanelPlacement = 'auto' | 'right' | 'left' | 'sheet';
export type Density = 'auto' | 'compact' | 'normal' | 'large';

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
  /** Panel tabs in the order shown. Only tabs listed here appear. */
  tabs: TabName[];
}

export const AUTO_LAYOUT = 'Automatic';

export const BUILTIN_LAYOUTS: Layout[] = [
  { name: AUTO_LAYOUT, panel: 'auto', panelWidth: 340, timelineHeight: 34, density: 'auto', tabs: [...TAB_NAMES] },
  { name: 'Panel on the left', panel: 'left', panelWidth: 340, timelineHeight: 34, density: 'auto', tabs: [...TAB_NAMES] },
  { name: 'Tall timeline', panel: 'right', panelWidth: 340, timelineHeight: 50, density: 'auto', tabs: [...TAB_NAMES] },
  { name: 'Bottom sheet', panel: 'sheet', panelWidth: 340, timelineHeight: 34, density: 'auto', tabs: [...TAB_NAMES] },
  { name: 'Compact', panel: 'right', panelWidth: 280, timelineHeight: 30, density: 'compact', tabs: [...TAB_NAMES] },
  { name: 'Large controls', panel: 'auto', panelWidth: 380, timelineHeight: 38, density: 'large', tabs: [...TAB_NAMES] },
];

export const LIMITS = { panelWidth: [240, 560], timelineHeight: [20, 60] } as const;
const clamp = (v: number, [lo, hi]: readonly [number, number] | readonly number[]) => Math.min(hi!, Math.max(lo!, Math.round(v)));

/** A usable layout from anything: wrong types and out-of-range numbers are repaired, unknown tabs dropped, at least one tab kept. */
export function cleanLayout(raw: unknown, fallback: Layout = BUILTIN_LAYOUTS[0]!): Layout | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  const panel: PanelPlacement = r.panel === 'right' || r.panel === 'left' || r.panel === 'sheet' || r.panel === 'auto' ? r.panel : fallback.panel;
  const density: Density = r.density === 'compact' || r.density === 'normal' || r.density === 'large' || r.density === 'auto' ? r.density : fallback.density;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const seen = new Set<string>();
  const tabs = (Array.isArray(r.tabs) ? r.tabs : []).filter((t): t is TabName => (TAB_NAMES as readonly string[]).includes(t as string) && !seen.has(t as string) && !!seen.add(t as string));
  return {
    name: r.name.trim().slice(0, 40),
    panel,
    panelWidth: clamp(num(r.panelWidth, fallback.panelWidth), LIMITS.panelWidth),
    timelineHeight: clamp(num(r.timelineHeight, fallback.timelineHeight), LIMITS.timelineHeight),
    density,
    tabs: tabs.length ? tabs : [...fallback.tabs],
  };
}

/** What the page needs to draw a layout on this screen. */
export interface AppliedLayout {
  panel: 'right' | 'left' | 'sheet';
  panelWidth: number;
  timelineHeight: number;
  density: 'compact' | 'normal' | 'large';
  tabs: TabName[];
}

export function applyLayout(l: Layout, narrow: boolean, touch: boolean): AppliedLayout {
  // A side panel cannot work on a narrow screen: the preview would be crushed, so it becomes the sheet.
  const wanted = l.panel === 'auto' ? 'right' : l.panel;
  const panel = narrow || l.panel === 'sheet' ? 'sheet' : wanted;
  return {
    panel,
    panelWidth: l.panelWidth,
    timelineHeight: l.timelineHeight,
    density: l.density === 'auto' ? (touch ? 'large' : 'normal') : l.density,
    tabs: l.tabs,
  };
}

export function exportLayout(l: Layout): string {
  return JSON.stringify({ format: 'turbocut.layout', version: 1, layout: l }, null, 2);
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
