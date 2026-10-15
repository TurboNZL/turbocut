import { describe, expect, it } from 'vitest';
import { AUTO_LAYOUT, BUILTIN_LAYOUTS, applyLayout, cleanLayout, exportLayout, findLayout, importLayout, uniqueLayoutName } from '../src/app/layout.ts';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/app/settings.ts';

describe('layouts', () => {
  const auto = BUILTIN_LAYOUTS[0]!;

  it('automatic is a right panel on a wide screen and a sheet on a narrow one', () => {
    expect(applyLayout(auto, false, false).panel).toBe('right');
    expect(applyLayout(auto, true, true).panel).toBe('sheet');
    expect(applyLayout(auto, false, true).density).toBe('large');
    expect(applyLayout(auto, false, false).density).toBe('normal');
  });

  it('a side panel never crushes a narrow screen', () => {
    const left = BUILTIN_LAYOUTS.find((l) => l.name === 'Panel on the left')!;
    expect(applyLayout(left, false, false).panel).toBe('left');
    expect(applyLayout(left, true, false).panel).toBe('sheet');
  });

  it('repairs wrong values and keeps at least one tab', () => {
    const l = cleanLayout({ name: ' Mine ', panel: 'top', panelWidth: 9999, timelineHeight: -4, density: 'huge', tabs: ['Keys', 'Nope', 'Keys', 'Clip'] })!;
    expect(l).toEqual({ name: 'Mine', panel: 'auto', panelWidth: 560, timelineHeight: 20, density: 'auto', tabs: ['Clip'] });
    expect(cleanLayout({ name: 'x', tabs: [] })!.tabs).toHaveLength(4);
    expect(cleanLayout({ panel: 'left' })).toBeNull();
    expect(cleanLayout('nope')).toBeNull();
  });

  it('moves the old Keys tab into Clip', () => {
    expect(cleanLayout({ name: 'Old', tabs: ['Media', 'Keys', 'Captions'] })!.tabs).toEqual(['Media', 'Clip', 'Captions']);
  });

  it('round-trips through a file and rejects other files', () => {
    const l = { ...auto, name: 'Wide', panel: 'left' as const, tabs: ['Media' as const, 'Clip' as const] };
    expect(importLayout(exportLayout(l))).toEqual(l);
    expect(() => importLayout('{"format":"other"}')).toThrow(/Not a TurboCut layout/);
    expect(() => importLayout('nope')).toThrow();
  });

  it('finds layouts by name and falls back to automatic', () => {
    const mine = { ...auto, name: 'Mine' };
    expect(findLayout('Mine', [mine])).toBe(mine);
    expect(findLayout('Compact', []).name).toBe('Compact');
    expect(findLayout('Gone', []).name).toBe(AUTO_LAYOUT);
    expect(uniqueLayoutName('Compact', [mine])).toBe('Compact 2');
    expect(uniqueLayoutName('Mine', [mine])).toBe('Mine 2');
  });

  it('stored layouts are cleaned when settings load', () => {
    const s = mergeSettings({ layout: 'Mine', layouts: [{ name: 'Mine', panelWidth: 100000 }, { nonsense: true }, 7] }, DEFAULT_SETTINGS(false));
    expect(s.layout).toBe('Mine');
    expect(s.layouts).toHaveLength(1);
    expect(s.layouts[0]!.panelWidth).toBe(560);
  });
});
