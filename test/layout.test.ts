import { describe, expect, it } from 'vitest';
import { AUTO_LAYOUT, BUILTIN_LAYOUTS, applyLayout, cleanLayout, column, exportLayout, findLayout, importLayout, layoutTabs, normalizeSizes, uniqueDivisionName, uniqueLayoutName } from '../src/app/layout.ts';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/app/settings.ts';
import { previewStride } from '../src/app/player.ts';

describe('layouts', () => {
  const auto = BUILTIN_LAYOUTS[0]!;
  const byName = (n: string) => BUILTIN_LAYOUTS.find((l) => l.name === n)!;

  it('there are four presets, not a dozen that barely differ', () => {
    expect(BUILTIN_LAYOUTS.map((l) => l.name)).toEqual([AUTO_LAYOUT, 'Library and editor', 'Stacked panels', 'Bottom sheet']);
  });

  it('automatic is a right panel on a wide screen and a sheet on a narrow one', () => {
    const wide = applyLayout(auto, false, false);
    expect(wide.mode).toBe('side');
    expect(wide.right).toHaveLength(1);
    expect(wide.left).toHaveLength(0);
    expect(applyLayout(auto, true, true).mode).toBe('sheet');
    expect(applyLayout(auto, false, true).density).toBe('large');
    expect(applyLayout(auto, false, false).density).toBe('normal');
  });

  it('two sides at once: separate panels left and right of the preview, one sheet on a narrow screen', () => {
    const two = byName('Library and editor');
    const wide = applyLayout(two, false, false);
    expect(wide.left.map((d) => d.name)).toEqual(['Library']);
    expect(wide.right.map((d) => d.name)).toEqual(['Editor']);
    const narrow = applyLayout(two, true, false);
    expect(narrow.mode).toBe('sheet');
    expect(narrow.left).toHaveLength(0);
    expect(narrow.right).toHaveLength(1);
    expect(narrow.right[0]!.tabs.sort()).toEqual(['Captions', 'Clip', 'Media', 'Project']);
  });

  it('panels on one side are stacked and their sizes add up to 100', () => {
    const stacked = byName('Stacked panels');
    const right = column(stacked, 'right');
    expect(right.map((d) => d.name)).toEqual(['Editor', 'Library']);
    expect(right.reduce((a, d) => a + d.size, 0)).toBe(100);
    expect(normalizeSizes(null, 3)).toEqual([33, 33, 34]);
    expect(normalizeSizes([10, 90], 2).reduce((a, b) => a + b, 0)).toBe(100);
    expect(normalizeSizes([50, 50, 50], 2)).toEqual([50, 50]); // wrong length: equal shares
  });

  it('repairs wrong values and keeps at least one tab', () => {
    const l = cleanLayout({ name: ' Mine ', panel: 'top', panelWidth: 9999, timelineHeight: -4, density: 'huge', tabs: ['Keys', 'Nope', 'Keys', 'Clip'] })!;
    expect(l.name).toBe('Mine');
    expect(l.panel).toBe('auto');
    expect(l.panelWidth).toBe(640);
    expect(l.timelineHeight).toBe(20);
    expect(l.density).toBe('auto');
    expect(l.divisions).toEqual([{ name: 'Panel', side: 'right', tabs: ['Clip'], size: 100 }]);
    expect(layoutTabs(cleanLayout({ name: 'x', tabs: [] })!)).toHaveLength(4);
    expect(cleanLayout({ panel: 'left' })).toBeNull();
    expect(cleanLayout('nope')).toBeNull();
  });

  it('a tab can only be in one panel, empty panels vanish, and there are at most six', () => {
    const l = cleanLayout({ name: 'x', divisions: [{ name: 'A', side: 'left', tabs: ['Clip', 'Clip'] }, { name: 'B', side: 'right', tabs: [] }, { name: 'C', side: 'right', tabs: ['Clip', 'Media'] }] })!;
    expect(l.divisions.map((d) => [d.name, d.side, d.tabs])).toEqual([['A', 'left', ['Clip']], ['C', 'right', ['Media']]]);
    expect(uniqueDivisionName('A', l.divisions)).toBe('A 2');
    const many = cleanLayout({ name: 'm', divisions: ['Clip', 'Media', 'Captions', 'Project'].map((t, i) => ({ name: `P${i}`, side: 'right', tabs: [t] })) })!;
    expect(many.divisions).toHaveLength(4);
  });

  it('old layouts are carried over: panes become panels on their side, Keys becomes Clip, Settings is dropped', () => {
    expect(layoutTabs(cleanLayout({ name: 'Old', tabs: ['Media', 'Keys', 'Captions'] })!)).toEqual(['Media', 'Clip', 'Captions']);
    const old = cleanLayout({ name: 'Old2', panel: 'left', panes: [['Clip'], ['Media', 'Settings']], paneSizes: [60, 40], dock: true })!;
    expect(old.panel).toBe('auto');
    expect(old.divisions.map((d) => [d.name, d.side, d.tabs, d.size])).toEqual([['Panel 1', 'left', ['Clip'], 60], ['Panel 2', 'left', ['Media'], 40]]);
  });

  it('round-trips through a file and rejects other files', () => {
    const l = { ...auto, name: 'Wide', divisions: [{ name: 'Left', side: 'left' as const, tabs: ['Media' as const], size: 100 }, { name: 'Right', side: 'right' as const, tabs: ['Clip' as const, 'Captions' as const], size: 100 }] };
    expect(importLayout(exportLayout(l))).toEqual(l);
    expect(() => importLayout('{"format":"other"}')).toThrow(/Not a TurboCut layout/);
    expect(() => importLayout('nope')).toThrow();
  });

  it('finds layouts by name and falls back to automatic (a preset that was removed too)', () => {
    const mine = { ...auto, name: 'Mine' };
    expect(findLayout('Mine', [mine])).toBe(mine);
    expect(findLayout('Stacked panels', []).name).toBe('Stacked panels');
    expect(findLayout('Compact', []).name).toBe(AUTO_LAYOUT);
    expect(findLayout('Gone', []).name).toBe(AUTO_LAYOUT);
    expect(uniqueLayoutName('Bottom sheet', [mine])).toBe('Bottom sheet 2');
    expect(uniqueLayoutName('Mine', [mine])).toBe('Mine 2');
  });

  it('stored layouts are cleaned when settings load', () => {
    const s = mergeSettings({ layout: 'Mine', layouts: [{ name: 'Mine', panelWidth: 100000 }, { nonsense: true }, 7] }, DEFAULT_SETTINGS(false));
    expect(s.layout).toBe('Mine');
    expect(s.layouts).toHaveLength(1);
    expect(s.layouts[0]!.panelWidth).toBe(640);
  });

  it('tools: in line with the play button with a mouse, under the timeline on a phone, unless the layout says', () => {
    expect(applyLayout(auto, false, false).tools).toBe('inline');
    expect(applyLayout(auto, false, true).tools).toBe('bottom');
    expect(applyLayout({ ...auto, tools: 'bottom' }, false, false).tools).toBe('bottom');
    expect(applyLayout({ ...auto, tools: 'float' }, false, true).tools).toBe('float');
    // "top" is in line on a computer, and a row just under the play bar (above the panel) on a phone
    expect(applyLayout({ ...auto, tools: 'top' }, false, false).tools).toBe('inline');
    expect(applyLayout({ ...auto, tools: 'top' }, true, true).tools).toBe('stage');
    expect(applyLayout({ ...auto, tools: 'row' }, false, false).tools).toBe('stage');
    expect(applyLayout({ ...auto, tools: 'left' }, false, false).tools).toBe('left');
    expect(applyLayout({ ...auto, tools: 'right' }, false, true).tools).toBe('bottom'); // a phone has no room for a column
    expect(cleanLayout({ name: 'x', tools: 'right' })?.tools).toBe('right');
    expect(cleanLayout({ name: 'x', tools: 'nonsense' })?.tools).toBe('auto');
  });
});

describe('settings that used to be layout parts', () => {
  it('the dock is a setting, off by default; a stored "Bottom dock" layout turns it on once', () => {
    expect(DEFAULT_SETTINGS(false).dock).toBe(false);
    expect(mergeSettings({ layout: 'Bottom dock' }, DEFAULT_SETTINGS(false)).dock).toBe(true);
    expect(mergeSettings({ layout: 'Mine', layouts: [{ name: 'Mine', dock: true, tabs: ['Clip'] }] }, DEFAULT_SETTINGS(false)).dock).toBe(true);
    expect(mergeSettings({ layout: 'Bottom dock', dock: false }, DEFAULT_SETTINGS(false)).dock).toBe(false);
  });

  it('the first tab is Media unless the person changed it', () => {
    expect(DEFAULT_SETTINGS(false).openTab).toBe('Media');
    expect(mergeSettings({ openTab: 'Captions' }, DEFAULT_SETTINGS(false)).openTab).toBe('Captions');
    expect(mergeSettings({ openTab: 'Nope' }, DEFAULT_SETTINGS(false)).openTab).toBe('Media');
    expect(mergeSettings({ autoSwitch: false }, DEFAULT_SETTINGS(false)).autoSwitch).toBe(false);
  });

  it('preview scale and rate are validated', () => {
    const s = mergeSettings({ previewScale: 50, previewFps: 'half' }, DEFAULT_SETTINGS(false));
    expect([s.previewScale, s.previewFps]).toEqual([50, 'half']);
    const bad = mergeSettings({ previewScale: 333, previewFps: 'turbo' }, DEFAULT_SETTINGS(false));
    expect([bad.previewScale, bad.previewFps]).toEqual(['auto', 'auto']);
  });
});

describe('preview rate and settings upgrade', () => {
  it('automatic: half of a 60 fps project on a touch screen, every frame elsewhere', () => {
    expect(previewStride('auto', 60, true)).toBe(2);
    expect(previewStride('auto', 30, true)).toBe(1);
    expect(previewStride('auto', 60, false)).toBe(1);
    expect(previewStride('third', 60, true)).toBe(3);
  });
  it('a stored "full" from before version 3 was the old default, not a choice', () => {
    expect(mergeSettings({ previewFps: 'full' }, DEFAULT_SETTINGS(true)).previewFps).toBe('auto');
    expect(mergeSettings({ previewFps: 'full', settingsVersion: 3 }, DEFAULT_SETTINGS(true)).previewFps).toBe('full');
  });
});
