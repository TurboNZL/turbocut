import { describe, expect, it } from 'vitest';
import { AUTO_LAYOUT, BUILTIN_LAYOUTS, applyLayout, cleanLayout, exportLayout, findLayout, importLayout, layoutTabs, normalizeSizes, uniqueLayoutName } from '../src/app/layout.ts';
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
    expect(l).toEqual({ name: 'Mine', panel: 'auto', panelWidth: 640, timelineHeight: 20, density: 'auto', panes: [['Clip']], paneSizes: [100], tools: 'auto', dock: false });
    expect(layoutTabs(cleanLayout({ name: 'x', tabs: [] })!)).toHaveLength(4);
    expect(cleanLayout({ panel: 'left' })).toBeNull();
    expect(cleanLayout('nope')).toBeNull();
  });

  it('moves the old Keys tab into Clip', () => {
    expect(layoutTabs(cleanLayout({ name: 'Old', tabs: ['Media', 'Keys', 'Captions'] })!)).toEqual(['Media', 'Clip', 'Captions']);
  });

  it('round-trips through a file and rejects other files', () => {
    const l = { ...auto, name: 'Wide', panel: 'left' as const, panes: [['Media' as const], ['Clip' as const]], paneSizes: [60, 40] };
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
    expect(s.layouts[0]!.panelWidth).toBe(640);
  });

  it('splits the panel into panes, keeps their sizes whole, and flattens them on a narrow screen', () => {
    const two = BUILTIN_LAYOUTS.find((l) => l.name === 'Two panels')!;
    expect(applyLayout(two, false, false).panes).toEqual([['Clip'], ['Media', 'Captions', 'Project']]);
    expect(applyLayout(two, true, false).panes).toEqual([['Clip', 'Media', 'Captions', 'Project']]);
    expect(applyLayout(two, true, false).paneSizes).toEqual([100]);
    expect(normalizeSizes(null, 3)).toEqual([33, 33, 34]);
    expect(normalizeSizes([10, 90], 2).reduce((a, b) => a + b, 0)).toBe(100);
    expect(normalizeSizes([50, 50, 50], 2)).toEqual([50, 50]); // wrong length: equal panes
    const l = cleanLayout({ name: 'x', panes: [['Clip', 'Clip'], [], ['Media'], ['Captions'], ['Project']], paneSizes: [30, 30, 40] })!;
    expect(l.panes).toEqual([['Clip'], ['Media'], ['Captions']]);
    expect(l.paneSizes).toHaveLength(3);
  });

  it('tools sit above the timeline with a mouse and below on a phone, unless the layout says', () => {
    expect(applyLayout(auto, false, false).tools).toBe('top');
    expect(applyLayout(auto, false, true).tools).toBe('bottom');
    expect(applyLayout({ ...auto, tools: 'bottom' }, false, false).tools).toBe('bottom');
  });

  it('the dock layout has Settings as a tab; the others do not', () => {
    const dock = BUILTIN_LAYOUTS.find((l) => l.name === 'Bottom dock')!;
    expect(applyLayout(dock, false, false).dock).toBe(true);
    expect(layoutTabs(dock)).toContain('Settings');
    expect(layoutTabs(auto)).not.toContain('Settings');
  });
});
