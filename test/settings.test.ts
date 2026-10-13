import { describe, expect, it } from 'vitest';
import { comboFromEvent, Hotkeys, prettyCombo, type HotkeyAction } from '../src/app/hotkeys.ts';
import { DEFAULT_SETTINGS, exportSettings, importSettings, mergeSettings } from '../src/app/settings.ts';

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('comboFromEvent', () => {
  it('names plain, modified and named keys', () => {
    expect(comboFromEvent(ev('s'))).toBe('S');
    expect(comboFromEvent(ev(' '))).toBe('Space');
    expect(comboFromEvent(ev('ArrowLeft', { shiftKey: true }))).toBe('Shift+ArrowLeft');
    expect(comboFromEvent(ev('z', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Z');
    expect(comboFromEvent(ev('z', { metaKey: true }))).toBe('Ctrl+Z'); // Cmd counts as Ctrl
  });
  it('does not count Shift for symbols that already need it', () => {
    expect(comboFromEvent(ev('?', { shiftKey: true }))).toBe('?');
    expect(comboFromEvent(ev('+', { shiftKey: true }))).toBe('+');
  });
  it('ignores modifier-only presses', () => {
    expect(comboFromEvent(ev('Shift', { shiftKey: true }))).toBe('');
    expect(comboFromEvent(ev('Control', { ctrlKey: true }))).toBe('');
  });
  it('prints combos for people', () => expect(prettyCombo('Shift+ArrowLeft')).toBe('Shift+←'));
});

describe('Hotkeys', () => {
  const make = () => {
    let stored: Record<string, string[]> = {};
    const ran: string[] = [];
    const hk = new Hotkeys(() => stored, (o) => (stored = o));
    const act = (id: string, keys: string[]): HotkeyAction => ({ id, label: id, group: 'x', keys, run: () => ran.push(id) });
    hk.register([act('split', ['S']), act('delete', ['Delete', 'Backspace']), act('snap', ['N'])]);
    return { hk, ran, stored: () => stored };
  };
  const key = (k: string) => ({ ...ev(k), preventDefault() {} }) as unknown as KeyboardEvent;

  it('runs the action bound to a key, defaults first', () => {
    const { hk, ran } = make();
    expect(hk.handle(key('s'))).toBe(true);
    expect(hk.handle(key('Backspace'))).toBe(true);
    expect(hk.handle(key('q'))).toBe(false);
    expect(ran).toEqual(['split', 'delete']);
  });
  it('rebinding replaces the default list for that action only', () => {
    const { hk, ran } = make();
    hk.setKeys('split', ['X']);
    expect(hk.handle(key('s'))).toBe(false);
    expect(hk.handle(key('x'))).toBe(true);
    expect(hk.keysFor('delete')).toEqual(['Delete', 'Backspace']);
    expect(ran).toEqual(['split']);
  });
  it('adding a key already used elsewhere takes it from the other action', () => {
    const { hk } = make();
    const taken = hk.addKey('snap', 'S');
    expect(taken?.id).toBe('split');
    expect(hk.keysFor('split')).toEqual([]);
    expect(hk.keysFor('snap')).toEqual(['N', 'S']);
  });
  it('resets one action or everything back to the defaults', () => {
    const { hk } = make();
    hk.setKeys('split', ['X']);
    hk.setKeys('snap', ['Y']);
    hk.reset('split');
    expect(hk.keysFor('split')).toEqual(['S']);
    expect(hk.isCustom('snap')).toBe(true);
    hk.resetAll();
    expect(hk.keysFor('snap')).toEqual(['N']);
  });
});

describe('settings', () => {
  const defaults = DEFAULT_SETTINGS(false);
  it('keeps only valid stored values', () => {
    const s = mergeSettings({ snapping: false, waveforms: 'yes', defaultFont: '  Squad Latin Black ', counters: 'weird', transcribe: { lang: 'en', compute: 'cuda' }, hotkeys: { split: ['X'], bad: 'nope' } }, defaults);
    expect(s.snapping).toBe(false);
    expect(s.waveforms).toBe(defaults.waveforms); // wrong type: default kept
    expect(s.defaultFont).toBe('Squad Latin Black');
    expect(s.counters).toBe(defaults.counters);
    expect(s.transcribe.lang).toBe('en');
    expect(s.transcribe.compute).toBe('auto');
    expect(s.hotkeys).toEqual({ split: ['X'] });
  });
  it('survives garbage', () => {
    expect(mergeSettings(null, defaults)).toEqual(defaults);
    expect(mergeSettings('x', defaults)).toEqual(defaults);
  });
  it('defaults differ for touch (no waveforms) and to English captions', () => {
    expect(DEFAULT_SETTINGS(true).waveforms).toBe(false);
    expect(defaults.transcribe.lang).toBe('english');
  });
  it('exports without the access token and imports back', () => {
    const s = structuredClone(defaults);
    s.transcribe.token = 'secret';
    s.snapping = false;
    const text = exportSettings(s);
    expect(text).not.toContain('secret');
    expect(importSettings(text, defaults).snapping).toBe(false);
    expect(() => importSettings('{"format":"nope"}', defaults)).toThrow('Not a TurboCut settings file');
  });

  it('defaults letter holes to filled, and upgrades the old stored default once', () => {
    const defaults = DEFAULT_SETTINGS(false);
    expect(defaults.counters).toBe('filled');
    expect(mergeSettings({ counters: 'rim' }, defaults).counters).toBe('filled'); // saved by the old default
    expect(mergeSettings({ counters: 'rim', settingsVersion: 2 }, defaults).counters).toBe('rim'); // a later, deliberate choice
    expect(mergeSettings({ counters: 'clear' }, defaults).counters).toBe('clear');
  });
});
