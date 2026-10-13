import { loadStoredFonts } from './fonts.ts';
import { layoutManager } from './layoutManager.ts';
import { openFontManager } from './fontManager.ts';
import { deviceCheck } from './deviceCheck.ts';
import { dialog, h } from './dom.ts';
import { comboFromEvent, prettyCombo, type Hotkeys } from './hotkeys.ts';
import { pickFiles, platform, saveFile } from './platform.ts';
import { DEFAULT_SETTINGS, exportSettings, importSettings, type CounterMode } from './settings.ts';
import type { Store } from './store.ts';
import { MODELS, type Compute } from '../transcribe/local.ts';
import { assetFor, checkForUpdate, desktopUpdater, openApk, type UpdateStatus } from './updater.ts';
import { APP_VERSION } from './version.ts';

export type SettingsTab = 'General' | 'Layout' | 'Fonts' | 'Keys' | 'Captions' | 'Updates' | 'Device' | 'About';
const TABS: SettingsTab[] = ['General', 'Layout', 'Fonts', 'Keys', 'Captions', 'Updates', 'Device', 'About'];

/** True while the shortcut editor is waiting for a key, so the editor's own shortcuts stay quiet. */
export let capturingKey = false;
/** The last thing the shortcut editor told the person, kept across redraws. */
let keyNote = '';

export interface SettingsDeps {
  store: Store;
  hotkeys: Hotkeys;
  touch: boolean;
}

const check = (label: string, on: boolean, set: (v: boolean) => void, hint?: string) => {
  const box = h('input', { type: 'checkbox', checked: on });
  box.addEventListener('change', () => set(box.checked));
  return h('label', { class: 'setting' }, box, h('span', {}, label, hint ? h('small', { class: 'hint' }, hint) : null));
};

const field = (label: string, control: HTMLElement) => h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, label), control);

/** The settings window. Everything that used to be scattered over panels lives here. */
export function openSettings(deps: SettingsDeps, tab: SettingsTab = 'General'): void {
  const { store } = deps;
  const body = h('div', { class: 'settings-body' });
  const nav = h('div', { class: 'settings-nav' });
  let current: SettingsTab = tab;

  const show = (t: SettingsTab) => {
    current = t;
    for (const b of nav.children) (b as HTMLElement).setAttribute('aria-current', b.textContent === t ? 'page' : 'false');
    body.replaceChildren(build(t));
    body.scrollTop = 0;
  };
  for (const t of TABS) nav.append(h('button', { class: 'bt-tab', onclick: () => show(t) }, t));

  const build = (t: SettingsTab): HTMLElement => {
    switch (t) {
      case 'General': return general(deps, () => show(current));
      case 'Layout': return layoutManager(store, () => show(current));
      case 'Fonts': return fontsTab(deps);
      case 'Keys': return keys(deps, () => show(current));
      case 'Captions': return captionsEngine(deps);
      case 'Updates': return updates(deps);
      case 'Device': return device(deps);
      case 'About': return about();
    }
  };

  dialog('Settings', h('div', { class: 'settings' }, nav, body), [], 'dlg-wide');
  show(tab);
}

function general({ store }: SettingsDeps, redraw: () => void): HTMLElement {
  const s = store.settings;
  const picker = Object.assign(document.createElement('turbo-themes-picker'), { variant: 'select' });

  const trackOrder = h('select', { class: 'input', 'aria-label': 'Track order' },
    h('option', { value: 'video', selected: s.videoOnTop }, 'Video tracks on top, audio below'),
    h('option', { value: 'audio', selected: !s.videoOnTop }, 'Audio tracks on top, video below'));
  trackOrder.addEventListener('change', () => store.updateSettings({ videoOnTop: trackOrder.value === 'video' }));

  const counters = h('select', { class: 'input', 'aria-label': 'Letter holes' },
    ...([['filled', 'Filled with the outline colour'], ['rim', 'Thin rim, open middle'], ['clear', 'Clear, the picture shows through']] as [CounterMode, string][]).map(([v, l]) => h('option', { value: v, selected: s.counters === v }, l)));
  counters.addEventListener('change', () => store.updateSettings({ counters: counters.value as CounterMode }));

  const fonts = h('datalist', { id: 'font-list' }, ...['Arial Black', 'Impact', 'Arial', 'Verdana', 'Georgia', 'Courier New'].map((f) => h('option', { value: f })));
  const font = h('input', { class: 'input', list: 'font-list', value: s.defaultFont, 'aria-label': 'Default font', placeholder: 'Font name' });
  font.addEventListener('change', () => store.updateSettings({ defaultFont: font.value.trim() || 'Arial Black' }));
  void loadStoredFonts().then((fam) => fam.forEach((f) => fonts.append(h('option', { value: f }))));
  const addFont = h('button', { class: 'btn', onclick: () => openFontManager(store, redraw) }, 'Manage fonts…');

  const exportBtn = h('button', { class: 'btn', onclick: () => saveFile(exportSettings(store.settings), 'turbocut-settings.json', 'application/json') }, 'Export settings');
  const importBtn = h('button', {
    class: 'btn',
    onclick: async () => {
      const [f] = await pickFiles('.json,application/json');
      if (!f) return;
      try {
        const next = importSettings(await f.text(), DEFAULT_SETTINGS(false));
        next.transcribe.token = store.settings.transcribe.token;
        store.updateSettings(() => Object.assign(store.settings, next));
        store.say('Settings imported.');
        redraw();
      } catch (e) {
        store.say(`Could not import: ${e instanceof Error ? e.message : e}`);
      }
    },
  }, 'Import settings');

  return h('div', { class: 'stack' },
    h('div', { class: 'bt-panel-title' }, 'Look'), picker,
    h('div', { class: 'bt-panel-title' }, 'Timeline'),
    check('Snap clips and edges to the playhead and to each other', s.snapping, (v) => store.updateSettings({ snapping: v }), 'Hotkey N toggles it.'),
    check('Show audio waveforms', s.waveforms, (v) => store.updateSettings({ waveforms: v }), 'Low detail. Uses a little more battery.'),
    field('Track order', trackOrder),
    h('div', { class: 'bt-panel-title' }, 'Captions and text'),
    field('Default font', font), fonts, addFont,
    field('Letter holes (o, e, a, g) in new styles', counters),
    h('div', { class: 'bt-panel-title' }, 'Updates'),
    check('Check for a new version when TurboCut starts', s.autoCheckUpdates, (v) => store.updateSettings({ autoCheckUpdates: v })),
    h('div', { class: 'bt-panel-title' }, 'Settings file'),
    h('div', { class: 'row' }, exportBtn, importBtn),
  );
}

function fontsTab({ store }: SettingsDeps): HTMLElement {
  return h('div', { class: 'stack' },
    h('p', { class: 'hint' }, `The default font is "${store.settings.defaultFont}". Add font files, see each one drawn, change the default or remove fonts in the font manager.`),
    h('button', { class: 'btn btn-accent', onclick: () => openFontManager(store) }, 'Open the font manager…'));
}

function keys({ hotkeys }: SettingsDeps, redraw: () => void): HTMLElement {
  const box = h('div', { class: 'stack' });
  const note = h('p', { class: 'hint' }, keyNote || 'Click a shortcut to remove it, "Add" to record a new one, or Reset to go back to the default.');
  const capture = (id: string) => {
    capturingKey = true;
    const msg = h('div', { class: 'capture' }, 'Press the new shortcut now… (Esc cancels)');
    box.prepend(msg);
    const end = () => {
      capturingKey = false;
      window.removeEventListener('keydown', onKey, true);
      msg.remove();
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = comboFromEvent(e);
      if (!combo) return; // only a modifier so far
      end();
      if (combo === 'Escape') return;
      const taken = hotkeys.addKey(id, combo);
      keyNote = taken ? `${prettyCombo(combo)} moved here from "${taken.label}".` : `${prettyCombo(combo)} added.`;
      redraw();
    };
    window.addEventListener('keydown', onKey, true);
  };

  const groups = new Map<string, ReturnType<Hotkeys['list']>>();
  for (const a of hotkeys.list()) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
  for (const [group, list] of groups) {
    box.append(h('div', { class: 'bt-panel-title' }, group));
    for (const a of list) {
      const chips = hotkeys.keysFor(a.id).map((k) => h('button', { class: 'btn kbd-chip', title: 'Remove this shortcut', onclick: () => (hotkeys.removeKey(a.id, k), redraw()) }, prettyCombo(k)));
      box.append(h('div', { class: 'key-row' },
        h('span', { class: 'key-label' }, a.label),
        h('span', { class: 'key-chips' }, chips.length ? chips : h('em', { class: 'hint' }, 'none')),
        h('button', { class: 'btn', onclick: () => capture(a.id) }, 'Add'),
        hotkeys.isCustom(a.id) ? h('button', { class: 'btn btn-ghost', onclick: () => (hotkeys.reset(a.id), redraw()) }, 'Reset') : h('span'),
      ));
    }
  }
  box.prepend(note, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => (hotkeys.resetAll(), redraw()) }, 'Reset all shortcuts')));
  return box;
}

function captionsEngine({ store }: SettingsDeps): HTMLElement {
  const t = store.settings.transcribe;
  const save = () => store.updateSettings((s) => (s.transcribe = { ...t }));
  const mode = h('select', { class: 'input' }, h('option', { value: 'local', selected: t.mode === 'local' }, 'On this device'), h('option', { value: 'remote', selected: t.mode === 'remote' }, 'A server on my network'));
  const model = h('select', { class: 'input' }, ...MODELS.map((m) => h('option', { value: m.id, selected: m.id === t.model }, m.label)));
  const compute = h('select', { class: 'input' },
    h('option', { value: 'auto', selected: t.compute === 'auto' }, 'Automatic'),
    h('option', { value: 'webgpu', selected: t.compute === 'webgpu' }, 'Graphics chip (WebGPU)'),
    h('option', { value: 'wasm', selected: t.compute === 'wasm' }, 'CPU (slower, most compatible)'));
  const lang = h('input', { class: 'input', value: t.lang, placeholder: 'english (blank = detect)' });
  const url = h('input', { class: 'input', value: t.url, placeholder: 'http://192.168.1.20:8787' });
  const token = h('input', { class: 'input', type: 'password', value: t.token, placeholder: 'Access token (optional)' });
  const local = h('div', { class: 'stack' }, field('Speech model', model), field('Processor', compute));
  const remote = h('div', { class: 'stack' }, field('Server address', url), field('Access token', token));
  const sync = () => {
    t.mode = mode.value as 'local' | 'remote';
    t.model = model.value;
    t.compute = compute.value as Compute;
    t.lang = lang.value.trim();
    t.url = url.value.trim();
    t.token = token.value.trim();
    local.style.display = t.mode === 'local' ? '' : 'none';
    remote.style.display = t.mode === 'remote' ? '' : 'none';
    save();
  };
  for (const el of [mode, model, compute, lang, url, token]) el.addEventListener('change', sync);
  sync();
  return h('div', { class: 'stack' },
    h('p', { class: 'hint' }, 'Used by Captions, Generate captions. On this device downloads a speech model the first time (about 80 MB for the balanced one) and then works offline.'),
    field('Where speech is recognised', mode), local, remote,
    field('Language', lang),
    h('p', { class: 'hint' }, 'English is the default. Detecting the language automatically can pick the wrong one on game or stream audio and give text that makes no sense.'),
  );
}

function updates({ store }: SettingsDeps): HTMLElement {
  const out = h('div', { class: 'stack' });
  const btn = h('button', { class: 'btn btn-accent' }, 'Check for updates');
  const run = async () => {
    btn.disabled = true;
    out.replaceChildren(h('p', { class: 'hint' }, 'Checking…'));
    try {
      const st = await checkForUpdate();
      out.replaceChildren(...(await describe(st)));
    } catch (e) {
      out.replaceChildren(h('p', {}, `Could not check: ${e instanceof Error ? e.message : e}`));
    } finally {
      btn.disabled = false;
    }
  };
  const describe = async (st: UpdateStatus): Promise<HTMLElement[]> => {
    if (!st.latest) return [h('p', {}, 'No releases found yet.')];
    if (!st.newer) return [h('p', {}, `You have the newest version, ${st.current}.`)];
    const asset = assetFor(st.latest);
    const rows: HTMLElement[] = [
      h('p', {}, h('strong', {}, `Version ${st.latest.version} is available`), ` (you have ${st.current}).`),
      st.latest.notes ? h('pre', { class: 'report' }, st.latest.notes.slice(0, 600)) : h('span'),
    ];
    const progress = h('progress', { class: 'prog', max: 100, value: 0, style: { display: 'none' } });
    const du = desktopUpdater;
    if (platform === 'electron' && du) {
      const can = await du.check();
      if (can.supported) {
        const go = h('button', { class: 'btn btn-accent' }, 'Download and restart');
        go.addEventListener('click', async () => {
          go.disabled = true;
          progress.style.display = '';
          du.onProgress((p) => (progress.value = p));
          try {
            await du.download();
            await du.install();
          } catch (e) {
            go.disabled = false;
            out.append(h('p', {}, `Update failed: ${e instanceof Error ? e.message : e}`));
          }
        });
        return [...rows, go, progress];
      }
      rows.push(h('p', { class: 'hint' }, can.reason ?? 'This copy cannot update itself.'));
    }
    if (platform === 'android' && asset) rows.push(h('button', { class: 'btn btn-accent', onclick: () => openApk(asset.url) }, 'Download the update (APK)'), h('p', { class: 'hint' }, 'Open the downloaded file to install it over the current version.'));
    else if (platform === 'web') rows.push(h('button', { class: 'btn btn-accent', onclick: () => location.reload() }, 'Reload to get it'), h('p', { class: 'hint' }, 'The web version is always the newest one.'));
    else if (asset) rows.push(h('a', { class: 'btn btn-accent', href: asset.url, target: '_blank', rel: 'noreferrer' }, `Download ${asset.name}`));
    rows.push(h('a', { class: 'btn', href: st.latest.pageUrl, target: '_blank', rel: 'noreferrer' }, 'Release page'));
    return rows;
  };
  btn.addEventListener('click', run);
  void store;
  return h('div', { class: 'stack' }, h('p', {}, `You have version ${APP_VERSION} (${platform}).`), btn, out);
}

function device({ store }: SettingsDeps): HTMLElement {
  const pre = h('pre', { class: 'report' }, 'Checking this device…');
  const copy = h('button', { class: 'btn btn-accent', onclick: () => navigator.clipboard?.writeText(pre.textContent ?? '').then(() => store.say('Report copied.')) }, 'Copy report');
  void deviceCheck(store.project.width, store.project.height).then((r) => (pre.textContent = r.text));
  return h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'What this device can encode and how fast. Copy it into a bug report.'), pre, copy);
}

function about(): HTMLElement {
  return h('div', { class: 'stack' },
    h('p', {}, h('strong', {}, 'TurboCut'), ` ${APP_VERSION}`),
    h('p', { class: 'hint' }, 'A small multi-track video editor with automatic captions. Versions are Year.Month.Update.'),
    h('p', {}, h('a', { href: 'https://github.com/TurboNZL/turbocut', target: '_blank', rel: 'noreferrer' }, 'github.com/TurboNZL/turbocut')),
    h('p', { class: 'hint' }, 'The look comes from turbothemes. TurboCut does not ship third-party fonts: add the fonts you have the right to use.'),
  );
}
