import { CONFIG_EXT, applyChosen, changedEntries, configText, previewConfig, readConfig, settingsFrom, type ConfigEntry } from './config.ts';
import { dialog, h, panel } from './dom.ts';
import { pickFiles, saveFile } from './platform.ts';
import { DEFAULT_SETTINGS, type Settings } from './settings.ts';
import type { Store } from './store.ts';

/** A friendlier name for a shortcut row: the id as the app knows it, passed in by the caller. */
export type KeyLabel = (id: string) => string;

const defaultsFor = (store: Store): Settings => DEFAULT_SETTINGS(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

/** Put a whole settings object in place of the live one (in place, so what holds a reference to it keeps working). */
function adopt(store: Store, next: Settings): void {
  store.updateSettings(() => Object.assign(store.settings, next));
}

/** One row with a tick box. */
const row = (checked: boolean, onChange: (v: boolean) => void, title: string, detail: string, group?: string) => {
  const box = h('input', { type: 'checkbox', checked, 'aria-label': title });
  box.addEventListener('change', () => onChange(box.checked));
  return h('label', { class: 'setting config-row' }, box, h('span', {}, h('strong', {}, title), h('small', { class: 'hint' }, `${group ? `${group} · ` : ''}${detail}`)));
};

/**
 * Settings → Config. Export: the settings that differ from the defaults, each with a tick box, so the ones forgotten about can be left out;
 * a preview of the file; save it, copy it, or apply it to this device (everything left out goes back to its default). Import: pick a file, see
 * what it would change (now → new), untick what you do not want, apply.
 */
export function configPage(store: Store, keyLabel: KeyLabel = (id) => id): HTMLElement {
  const root = h('div', { class: 'stack config' });
  const label = (e: ConfigEntry) => (e.path.startsWith('hotkeys.') ? `Shortcut: ${keyLabel(e.path.slice(8))}` : e.label);

  // ---------------------------------------------------------------- export
  const left = new Set<string>(); // paths the person took out of the config
  const list = h('div', { class: 'config-list' });
  const preview = h('pre', { class: 'report config-preview', 'aria-label': 'Preview of the config file' });
  const count = h('p', { class: 'hint' });
  const chosen = () => changedEntries(store.settings, defaultsFor(store)).filter((e) => !left.has(e.path));
  const drawExport = () => {
    const all = changedEntries(store.settings, defaultsFor(store));
    if (all.length === 0) {
      list.replaceChildren(h('p', { class: 'hint' }, 'Every setting is at its default, so there is nothing to put in a config.'));
      preview.textContent = '';
      count.textContent = '';
      return;
    }
    list.replaceChildren(...all.map((e) => row(!left.has(e.path), (v) => (v ? left.delete(e.path) : left.add(e.path), drawPreview()), label(e), e.text, e.group)));
    drawPreview();
  };
  const drawPreview = () => {
    const c = chosen();
    const total = changedEntries(store.settings, defaultsFor(store)).length;
    count.textContent = `${c.length} of the ${total} settings you changed ${c.length === 1 ? 'is' : 'are'} in the config.`;
    preview.textContent = configText(c);
  };
  const toggleAll = (on: boolean) => {
    left.clear();
    if (!on) for (const e of changedEntries(store.settings, defaultsFor(store))) left.add(e.path);
    drawExport();
  };
  const save = h('button', { class: 'btn btn-accent', onclick: () => void saveFile(configText(chosen()), `turbocut${CONFIG_EXT}`, 'application/json') }, 'Save config file');
  const copy = h('button', { class: 'btn', onclick: async () => {
    try {
      await navigator.clipboard.writeText(configText(chosen()));
      store.say('Config copied.');
    } catch {
      store.say('This device did not allow copying. Save the file instead.');
    }
  } }, 'Copy');
  const applyHere = h('button', { class: 'btn', onclick: () => confirmApply() }, 'Apply this config to this instance');

  /** Applying makes this device exactly the config: what was left out goes back to its default. Say what that is before doing it. */
  const confirmApply = () => {
    const keep = chosen();
    const reset = changedEntries(store.settings, defaultsFor(store)).filter((e) => left.has(e.path));
    const next = settingsFrom(keep, defaultsFor(store));
    const dlg = dialog('Apply this config here?', h('div', { class: 'stack' },
      h('p', {}, `This device will use the ${keep.length} setting${keep.length === 1 ? '' : 's'} in the config, and everything else goes back to its default.`),
      reset.length ? h('div', {}, h('p', { class: 'hint' }, 'These go back to their defaults:'), h('ul', { class: 'relink-list' }, ...reset.map((e) => h('li', {}, `${label(e)} (now ${e.text})`)))) : h('p', { class: 'hint' }, 'Nothing is lost: every setting you changed is in the config.')), [
      h('button', { class: 'btn btn-accent', onclick: () => (adopt(store, next), dlg.close(), left.clear(), drawExport(), store.say('The config is applied to this device.')) }, 'Apply'),
      h('button', { class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Cancel'),
    ]);
  };

  // ---------------------------------------------------------------- import
  const imported = h('div', { class: 'stack' });
  const startImport = async () => {
    const [f] = await pickFiles(`${CONFIG_EXT},.json,application/json`);
    if (!f) return;
    try {
      showImport(previewConfig(store.settings, readConfig(await f.text())), f.name);
    } catch (e) {
      imported.replaceChildren(h('p', {}, e instanceof Error ? e.message : String(e)));
    }
  };
  const showImport = ({ next, changes }: ReturnType<typeof previewConfig>, name: string) => {
    if (changes.length === 0) return void imported.replaceChildren(h('p', {}, `${name} changes nothing: this device already uses every setting in it.`));
    const picked = new Set(changes.map((c) => c.entry.path));
    const go = h('button', { class: 'btn btn-accent' });
    const sync = () => {
      go.textContent = `Apply ${picked.size} setting${picked.size === 1 ? '' : 's'}`;
      go.toggleAttribute('disabled', picked.size === 0);
    };
    go.addEventListener('click', () => {
      adopt(store, applyChosen(store.settings, next, picked));
      imported.replaceChildren(h('p', {}, `Applied ${picked.size} setting${picked.size === 1 ? '' : 's'} from ${name}.`));
      store.say('Config applied.');
      drawExport();
    });
    imported.replaceChildren(
      h('p', {}, h('strong', {}, name), `: ${changes.length} setting${changes.length === 1 ? '' : 's'} would change. Untick any you do not want.`),
      ...changes.map((c) => row(true, (v) => (v ? picked.add(c.entry.path) : picked.delete(c.entry.path), sync()), label(c.entry), `${c.before} → ${c.entry.text}`, c.entry.group)),
      h('div', { class: 'row' }, go, h('button', { class: 'btn btn-ghost', onclick: () => imported.replaceChildren() }, 'Cancel')),
    );
    sync();
  };

  drawExport();
  root.append(
    panel('Export a config',
      h('p', { class: 'hint' }, 'A config is a file with your settings, to keep as a backup or to set up another device. Only the settings that differ from the defaults are listed. Untick the ones you forgot you changed, or do not want to carry over.'),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-ghost', onclick: () => toggleAll(true) }, 'Select all'), h('button', { class: 'btn btn-ghost', onclick: () => toggleAll(false) }, 'Select none')),
      list, count,
      h('details', { class: 'config-details' }, h('summary', {}, 'Preview the file'), preview),
      h('div', { class: 'row' }, save, copy, applyHere)),
    panel('Import a config',
      h('p', { class: 'hint' }, 'Choose a config file. You see what it would change before anything is applied; settings it does not mention stay as they are.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => void startImport() }, 'Choose a config file…')),
      imported),
  );
  return root;
}
