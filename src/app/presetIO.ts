import { PresetError, exportPreset, parsePresetFile, presetFromAss, type CaptionPreset, type EmbeddedFont } from '../captions/presets.ts';
import { dialog, h } from './dom.ts';
import { fontsForFamilies, installFonts, toBase64 } from './fonts.ts';
import { pickFiles, saveFile } from './platform.ts';
import type { Store } from './store.ts';

const fileName = (name: string) => `${name.replace(/[\\/:*?"<>|]+/g, '_')}.turbocut-preset.json`;

/** Fonts the styles of this preset ask for that were added by the user (system fonts like Arial are not files we can bundle). */
async function bundledFor(p: CaptionPreset): Promise<{ found: EmbeddedFont[]; missing: string[] }> {
  const wanted = [...new Set(p.styles.map((s) => s.fontname))];
  const stored = await fontsForFamilies(wanted);
  const have = new Set(stored.flatMap((f) => f.families.map((x) => x.toLowerCase())));
  return {
    found: stored.map((f) => ({ families: f.families, data: toBase64(f.bytes) })),
    missing: wanted.filter((w) => !have.has(w.toLowerCase())),
  };
}

/** Export the preset. The fonts it uses are included unless the box is cleared. */
export async function exportPresetDialog(store: Store, preset: CaptionPreset = store.preset): Promise<void> {
  const { found, missing } = await bundledFor(preset);
  const include = h('input', { type: 'checkbox', checked: found.length > 0, disabled: found.length === 0, 'aria-label': 'Include fonts' });
  const note = h('p', { class: 'hint' });
  const size = found.reduce((n, f) => n + Math.floor((f.data.length * 3) / 4), 0);
  const update = () => {
    note.textContent = include.checked
      ? `The font file${found.length === 1 ? '' : 's'} will be inside the preset (about ${(size / 1024).toFixed(0)} KB), so it looks the same on any device. Only share fonts you may redistribute.`
      : 'Fonts are left out. Whoever imports this needs the fonts already, or adds them afterwards.';
  };
  include.addEventListener('change', update);
  update();
  const dlg = dialog(
    'Export style',
    h('div', {},
      h('p', {}, `"${preset.name}" with ${preset.styles.length} variant${preset.styles.length === 1 ? '' : 's'}.`),
      found.length ? h('label', { class: 'setting' }, include, h('span', {}, `Include fonts (${found.flatMap((f) => f.families.slice(0, 1)).join(', ')})`)) : null,
      found.length ? note : null,
      missing.length ? h('p', { class: 'hint' }, `Not bundled, because they are not font files added to TurboCut: ${missing.join(', ')}.`) : null,
    ),
    [
      h('button', { class: 'btn btn-accent', onclick: () => { void saveFile(exportPreset(preset, include.checked ? found : []), fileName(preset.name), 'application/json'); dlg.close(); } }, 'Export'),
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
    ],
  );
}

/** Read a preset file (TurboCut JSON or an .ass file), install any fonts inside it, and make it the active style. */
export async function importPresetFile(store: Store, file: File): Promise<void> {
  try {
    const text = await file.text();
    let preset: CaptionPreset;
    let fonts: EmbeddedFont[] = [];
    if (/\.ass$/i.test(file.name)) preset = presetFromAss(file.name.replace(/\.ass$/i, ''), text);
    else ({ preset, fonts } = parsePresetFile(text));
    preset.name = store.uniquePresetName(preset.name);
    delete preset.builtin;
    const families = fonts.length ? await installFonts(fonts) : [];
    store.setPreset(preset);
    store.say(`Style "${preset.name}" imported (${preset.styles.length} variants${families.length ? `, font ${families[0]} added` : ''}).`);
  } catch (e) {
    store.say(e instanceof PresetError ? `Not a usable style: ${e.message}` : `Could not read that file: ${e}`);
  }
}

export async function pickAndImportPreset(store: Store): Promise<void> {
  for (const f of await pickFiles('.json,.ass,application/json', true)) await importPresetFile(store, f);
}
