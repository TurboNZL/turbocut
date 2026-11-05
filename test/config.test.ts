import { describe, expect, it } from 'vitest';
import { applyChosen, changedEntries, configText, previewConfig, readConfig, settingsFrom } from '../src/app/config.ts';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/app/settings.ts';

const defaults = DEFAULT_SETTINGS(false);
const changed = () => {
  const s = structuredClone(defaults);
  s.snapping = false;
  s.trackOrder = ['captions', 'audio', 'video'];
  s.transcribe.lang = 'german';
  s.hotkeys.split = ['Ctrl+B'];
  s.layouts = [{ name: 'Mine', panels: [] } as any];
  return s;
};

describe('config', () => {
  it('lists only what differs from the defaults', () => {
    const paths = changedEntries(changed(), defaults).map((e) => e.path);
    expect(paths.sort()).toEqual(['hotkeys.split', 'layouts.Mine', 'snapping', 'trackOrder', 'transcribe.lang']);
    expect(changedEntries(defaults, defaults)).toEqual([]);
  });

  it('writes the chosen settings and reads them back', () => {
    const entries = changedEntries(changed(), defaults).filter((e) => e.path !== 'snapping'); // one the person removed
    const partial = readConfig(configText(entries));
    expect(partial).toMatchObject({ trackOrder: ['captions', 'audio', 'video'], transcribe: { lang: 'german' }, hotkeys: { split: ['Ctrl+B'] } });
    expect('snapping' in partial).toBe(false);
  });

  it('previews what an import would change, and only that', () => {
    const current = structuredClone(defaults);
    current.autosave = false;
    const { changes } = previewConfig(current, readConfig(configText(changedEntries(changed(), defaults))));
    const by = Object.fromEntries(changes.map((c) => [c.entry.path, c.before]));
    expect(Object.keys(by).sort()).toEqual(['hotkeys.split', 'layouts.Mine', 'snapping', 'trackOrder', 'transcribe.lang']);
    expect(by.snapping).toBe('on');
    expect(current.autosave).toBe(false); // a setting the config does not mention stays as it is
  });

  it('drops invalid values instead of trusting them', () => {
    const { changes } = previewConfig(defaults, { snapping: 'yes', trackOrder: ['video'], previewScale: 7, transcribe: { model: 5 } });
    expect(changes).toEqual([]);
  });

  it('takes over only the chosen settings', () => {
    const current = structuredClone(defaults);
    const { next, changes } = previewConfig(current, readConfig(configText(changedEntries(changed(), defaults))));
    expect(changes.length).toBe(5);
    const out = applyChosen(current, next, new Set(['snapping', 'transcribe.lang']));
    expect(out.snapping).toBe(false);
    expect(out.transcribe.lang).toBe('german');
    expect(out.trackOrder).toEqual(defaults.trackOrder);
    expect(out.hotkeys).toEqual({});
  });

  it('keeps layouts that the config does not name', () => {
    const current = structuredClone(defaults);
    current.layouts = [{ name: 'Old', panels: [] } as any];
    const { next } = previewConfig(current, readConfig(configText(changedEntries(changed(), defaults).filter((e) => e.path === 'layouts.Mine'))));
    expect(next.layouts.map((l) => l.name).sort()).toEqual(['Mine', 'Old']);
  });

  it('applying a config to this device resets what it leaves out', () => {
    const current = changed();
    const keep = changedEntries(current, defaults).filter((e) => e.path === 'trackOrder');
    const out = settingsFrom(keep, defaults);
    expect(out.trackOrder).toEqual(['captions', 'audio', 'video']);
    expect(out.snapping).toBe(true);
    expect(out.hotkeys).toEqual({});
  });

  it('refuses files that are not configs, and reads the older settings file', () => {
    expect(() => readConfig('nope')).toThrow(/not valid JSON/);
    expect(() => readConfig('{"format":"x"}')).toThrow(/not a TurboCut config/);
    expect(() => readConfig('{"format":"turbocut.config","version":2,"settings":{}}')).toThrow(/newer/);
    const old = JSON.stringify({ format: 'turbocut.settings', version: 1, settings: { snapping: false } });
    expect(previewConfig(defaults, readConfig(old)).changes.map((c) => c.entry.path)).toEqual(['snapping']);
  });

  it('turns the old "video on top" setting into the row order', () => {
    expect(mergeSettings({ videoOnTop: false }, defaults).trackOrder).toEqual(['audio', 'video', 'captions']);
    expect(mergeSettings({ videoOnTop: true }, defaults).trackOrder).toEqual(['video', 'audio', 'captions']);
    expect(mergeSettings({ trackOrder: ['captions', 'video', 'audio'] }, defaults).trackOrder).toEqual(['captions', 'video', 'audio']);
    expect(mergeSettings({ trackOrder: ['video', 'video', 'audio'] }, defaults).trackOrder).toEqual(['video', 'audio', 'captions']);
  });
});
