import { loadStoredFonts } from './fonts.ts';
import { fontPicker } from './fontPicker.ts';
import { icon } from './icons.ts';
import { guidesView } from './guides.ts';
import { layoutManager } from './layoutManager.ts';
import { openFontManager } from './fontManager.ts';
import { deviceCheck } from './deviceCheck.ts';
import { dialog, h, panel } from './dom.ts';
import { comboFromEvent, prettyCombo, type Hotkeys } from './hotkeys.ts';
import { pickFiles, platform, saveFile } from './platform.ts';
import { DEFAULT_SETTINGS, PREVIEW_FPS, PREVIEW_SCALES, exportSettings, importSettings, type CounterMode, type PreviewFps, type PreviewScale } from './settings.ts';
import type { Store } from './store.ts';
import { MODELS, type Compute } from '../transcribe/local.ts';
import { desktopWindow } from './windowFrame.ts';
import { shareApi } from './share.ts';
import { assetFor, checkForUpdate, apkUpdater, desktopUpdater, openApk, type UpdateStatus } from './updater.ts';
import { APP_VERSION } from './version.ts';

export type SettingsTab = 'General' | 'Look' | 'Layout' | 'Fonts' | 'Guides' | 'Keys' | 'Captions' | 'Updates' | 'Device' | 'About';
/** The pages of Settings in groups, so nine small tabs read as three short lists. */
const GROUPS: [string, SettingsTab[]][] = [
  ['Editor', ['General', 'Look', 'Layout', 'Keys']],
  ['Captions and text', ['Captions', 'Fonts']],
  ['App', ['Updates', 'Device', 'Guides', 'About']],
];
const TABS: SettingsTab[] = GROUPS.flatMap(([, t]) => t);

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

/**
 * Settings as a page that works in a window and in a side panel: a search box, the list of pages (a column when there is room,
 * a row when the space is narrow: it follows its own width, not the screen's) and the page. Typing in the search shows every
 * setting in every page that matches, grouped by page; clearing it goes back to the page you were on.
 */
export function settingsView(deps: SettingsDeps, tab: SettingsTab = 'General'): { el: HTMLElement; show: (t: SettingsTab) => void; focusSearch: () => void } {
  const { store } = deps;
  const body = h('div', { class: 'settings-body' });
  const nav = h('div', { class: 'settings-nav', role: 'tablist', 'aria-orientation': 'vertical' });
  const search = h('input', { class: 'input settings-search', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings', spellcheck: false });
  let current: SettingsTab = tab;
  let searching = '';

  const show = (t: SettingsTab) => {
    current = t;
    searching = '';
    search.value = '';
    for (const b of nav.querySelectorAll<HTMLElement>('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    body.replaceChildren(build(t));
    body.scrollTop = 0;
  };
  for (const [group, tabs] of GROUPS) {
    nav.append(h('div', { class: 'settings-group', role: 'presentation' }, group));
    for (const t of tabs) nav.append(h('button', { class: 'tab', role: 'tab', 'data-tab': t, onclick: () => show(t) }, t));
  }

  /** Draw the page again where the person was in it: a changed shortcut or a made copy must not throw them back to the top. */
  const refresh = () => {
    const top = body.scrollTop;
    show(current);
    body.scrollTop = top;
  };
  const build = (t: SettingsTab): HTMLElement => {
    switch (t) {
      case 'General': return general(deps, refresh);
      case 'Look': return look(deps, refresh);
      case 'Layout': return layoutManager(store, refresh);
      case 'Fonts': return fontsTab(deps, refresh);
      case 'Guides': return guidesView();
      case 'Keys': return keys(deps, refresh);
      case 'Captions': return captionsEngine(deps);
      case 'Updates': return updates(deps);
      case 'Device': return device(deps);
      case 'About': return about();
    }
  };

  // ---- search: every page is built once for the search, then rows and panels that do not match are hidden
  const SEARCHABLE: SettingsTab[] = TABS.filter((t) => t !== 'Guides');
  let built = new Map<SettingsTab, HTMLElement>();
  const runSearch = (q: string) => {
    searching = q;
    if (!q) return show(current);
    for (const b of nav.querySelectorAll('.tab')) b.setAttribute('aria-selected', 'false');
    if (built.size === 0) for (const t of SEARCHABLE) built.set(t, build(t));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const sections: HTMLElement[] = [];
    for (const [t, el] of built) {
      const shown = filterPage(el, words);
      if (shown) sections.push(h('section', { class: 'settings-hit' }, h('h2', { class: 'settings-hit-title' }, t), el));
    }
    body.replaceChildren(...(sections.length ? sections : [h('p', { class: 'hint settings-none' }, `Nothing in Settings matches "${q}".`)]));
    body.scrollTop = 0;
  };
  search.addEventListener('input', () => {
    const q = search.value.trim();
    if (!q) built = new Map();
    runSearch(q);
  });
  search.addEventListener('keydown', (e) => e.key === 'Escape' && search.value && (e.stopPropagation(), (search.value = ''), built = new Map(), runSearch('')));

  const root = h('div', { class: 'settings-shell' }, h('div', { class: 'settings-top' }, h('span', { class: 'settings-search-icon' }, icon('search', 16)), search), h('div', { class: 'settings' }, nav, body));
  show(tab);
  void searching;
  return { el: root, show, focusSearch: () => search.focus({ preventScroll: true }) };
}

/** Hide what does not match in one page (rows, then whole panels). Returns how many rows or panels stay. */
function filterPage(page: HTMLElement, words: string[]): number {
  const has = (el: Element) => {
    const t = (el.textContent ?? '').toLowerCase() + ' ' + [...el.querySelectorAll('input, select, textarea, button')].map((x) => `${(x as HTMLElement).getAttribute('aria-label') ?? ''} ${(x as HTMLInputElement).placeholder ?? ''} ${(x as HTMLElement).title ?? ''}`).join(' ').toLowerCase();
    return words.every((w) => t.includes(w));
  };
  let visible = 0;
  const panels = [...page.querySelectorAll<HTMLElement>('.card.bt-panel')];
  for (const panel of panels.length ? panels : [page]) {
    const title = panel.querySelector('.bt-panel-title')?.textContent?.toLowerCase() ?? '';
    const titleHit = words.every((w) => title.includes(w));
    const units = [...panel.querySelectorAll<HTMLElement>('.setting, .key-row, .tab-row, .font-row, .layout-card')];
    if (titleHit || units.length === 0) {
      const ok = titleHit || has(panel);
      panel.hidden = !ok;
      for (const u of units) u.hidden = false;
      if (ok) visible++;
      continue;
    }
    let any = 0;
    for (const u of units) {
      const ok = has(u);
      u.hidden = !ok;
      if (ok) any++;
    }
    panel.hidden = any === 0;
    visible += any;
  }
  return visible;
}

/** The settings window. */
export function openSettings(deps: SettingsDeps, tab: SettingsTab = 'General'): void {
  const view = settingsView(deps, tab);
  dialog('Settings', view.el, [], 'dlg-wide dlg-settings');
  queueMicrotask(() => view.focusSearch()); // typing right away searches the settings
}

function general({ store }: SettingsDeps, redraw: () => void): HTMLElement {
  const s = store.settings;
  const trackOrder = h('select', { class: 'input', 'aria-label': 'Track order' },
    h('option', { value: 'video', selected: s.videoOnTop }, 'Video tracks on top, audio below'),
    h('option', { value: 'audio', selected: !s.videoOnTop }, 'Audio tracks on top, video below'));
  trackOrder.addEventListener('change', () => store.updateSettings({ videoOnTop: trackOrder.value === 'video' }));

  const SCALE_LABEL: Record<string, string> = { auto: 'Automatic (up to 960 px on the long side, 640 px on a phone)', '100': 'Full size of the project', '75': '75 %', '50': '50 %', '25': '25 %, draft' };
  const previewScale = h('select', { class: 'input', 'aria-label': 'Preview sharpness' }, ...PREVIEW_SCALES.map((v) => h('option', { value: String(v), selected: s.previewScale === v }, SCALE_LABEL[String(v)]!)));
  previewScale.addEventListener('change', () => store.updateSettings({ previewScale: (previewScale.value === 'auto' ? 'auto' : Number(previewScale.value)) as PreviewScale }));
  const FPS_LABEL: Record<PreviewFps, string> = { auto: 'Automatic (30 a second on a phone, every frame on a computer)', full: 'Every frame', half: 'Half of the frames', third: 'A third of the frames', quarter: 'A quarter of the frames' };
  const previewFps = h('select', { class: 'input', 'aria-label': 'Preview frame rate' }, ...PREVIEW_FPS.map((v) => h('option', { value: v, selected: s.previewFps === v }, FPS_LABEL[v])));
  previewFps.addEventListener('change', () => store.updateSettings({ previewFps: previewFps.value as PreviewFps }));

  const exportBtn = h('button', { class: 'btn', onclick: () => saveFile(exportSettings(store.settings), 'turbocut-settings.json', 'application/json') }, 'Export settings');
  const importBtn = h('button', {
    class: 'btn',
    onclick: async () => {
      const [f] = await pickFiles('.json,application/json');
      if (!f) return;
      try {
        const next = importSettings(await f.text(), DEFAULT_SETTINGS(false));
        store.updateSettings(() => Object.assign(store.settings, next));
        store.say('Settings imported.');
        redraw();
      } catch (e) {
        store.say(`Could not import: ${e instanceof Error ? e.message : e}`);
      }
    },
  }, 'Import settings');

  return h('div', { class: 'stack' },
    panel('Timeline',
      check('Snap clips and edges to the playhead and to each other', s.snapping, (v) => store.updateSettings({ snapping: v }), 'Hotkey N toggles it.'),
      check('Show audio waveforms', s.waveforms, (v) => store.updateSettings({ waveforms: v }), 'Low detail. Uses a little more battery.'),
      field('Track order', trackOrder)),
    panel('Preview',
      h('p', { class: 'hint' }, 'How the picture is drawn while you edit. Exports are always full size and full rate. A lower setting keeps a slow phone smooth.'),
      field('Sharpness', previewScale),
      field('Frame rate while playing', previewFps)),
    panel('Start', check('Show the home screen when TurboCut starts with an empty project', s.showHome, (v) => store.updateSettings({ showHome: v }), 'The Home button at the top brings it back.')),
    panel('Updates', check('Check for a new version when TurboCut starts', s.autoCheckUpdates, (v) => store.updateSettings({ autoCheckUpdates: v }))),
    panel('Settings file', h('div', { class: 'row' }, exportBtn, importBtn)),
  );
}

/** The Look page: the colour theme, UI style and wallpaper picker from turbothemes, and how the window itself is drawn. */
function look({ store }: SettingsDeps, redraw: () => void): HTMLElement {
  const picker = Object.assign(document.createElement('turbo-themes-picker'), { variant: 'select' });
  const w = desktopWindow;
  return h('div', { class: 'stack' },
    panel('Look', h('p', { class: 'hint' }, 'Colours, shapes and motion come from the theme you pick. Every look works with every layout.'), picker),
    panel('Window',
      check('Bottom dock with Home, Edit and Settings', store.settings.dock, (v) => (store.updateSettings({ dock: v }), redraw()), 'A bar along the bottom of the window, drawn by the look. Settings opens as a page instead of a window.'),
      ...(w
        ? [
            check('Draw the title bar from the theme', w.customFrame, (v) => void w.setCustomFrame(v), 'Applies after TurboCut restarts. Turn it off to use your desktop\'s own title bar; macOS always uses its own.'),
          ]
        : [])));
}

function fontsTab({ store }: SettingsDeps, redraw: () => void): HTMLElement {
  const s = store.settings;
  const counters = h('select', { class: 'input', 'aria-label': 'Letter holes' },
    ...([['filled', 'Filled with the outline colour'], ['rim', 'Thin rim, open middle'], ['clear', 'Clear, the picture shows through']] as [CounterMode, string][]).map(([v, l]) => h('option', { value: v, selected: s.counters === v }, l)));
  counters.addEventListener('change', () => store.updateSettings({ counters: counters.value as CounterMode }));
  const defaultFont = fontPicker({
    value: s.defaultFont,
    ariaLabel: 'Default font',
    onInput: () => {},
    onCommit: () => store.updateSettings({ defaultFont: defaultFont.input.value.trim() || 'Arial Black' }),
  });
  void loadStoredFonts();
  return h('div', { class: 'stack' },
    panel('Default font', h('p', { class: 'hint' }, 'Used by new caption styles, new text layers and the built-in caption style.'), field('Font', defaultFont.el), field('Letter holes (o, e, a, g) in new styles', counters)),
    panel('Font manager', h('p', { class: 'hint' }, 'Add font files, see every installed font drawn in itself, change the default or remove fonts.'), h('button', { class: 'btn btn-accent', onclick: () => openFontManager(store, redraw) }, 'Open the font manager…')));
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
    const section = panel(group);
    box.append(section);
    for (const a of list) {
      const chips = hotkeys.keysFor(a.id).map((k) => h('button', { class: 'btn kbd-chip', title: 'Remove this shortcut', onclick: () => (hotkeys.removeKey(a.id, k), redraw()) }, prettyCombo(k)));
      section.append(h('div', { class: 'key-row' },
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
  const model = h('select', { class: 'input', 'aria-label': 'Speech model' }, ...MODELS.map((m) => h('option', { value: m.id, selected: m.id === t.model }, m.label)));
  const compute = h('select', { class: 'input', 'aria-label': 'Processor' },
    h('option', { value: 'auto', selected: t.compute === 'auto' }, 'Automatic'),
    h('option', { value: 'webgpu', selected: t.compute === 'webgpu' }, 'Graphics chip (WebGPU)'),
    h('option', { value: 'wasm', selected: t.compute === 'wasm' }, 'CPU (slower, most compatible)'));
  const grouping = h('select', { class: 'input', 'aria-label': 'Caption length' },
    h('option', { value: 'auto', selected: t.grouping === 'auto' }, 'Automatic: short lines on tall video, sentences on wide video'),
    h('option', { value: 'short', selected: t.grouping === 'short' }, 'Short lines (a few words at a time)'),
    h('option', { value: 'sentence', selected: t.grouping === 'sentence' }, 'Whole sentences'));
  const lang = h('input', { class: 'input', value: t.lang, placeholder: 'english (blank = detect)', 'aria-label': 'Language' });
  const sync = () => {
    if (model.value !== t.model) t.modelChosen = true; // picking one here counts as the first-use choice
    t.model = model.value;
    t.grouping = grouping.value as typeof t.grouping;
    t.compute = compute.value as Compute;
    t.lang = lang.value.trim();
    save();
  };
  for (const el of [model, compute, grouping, lang]) el.addEventListener('change', sync);
  return h('div', { class: 'stack' },
    h('p', { class: 'hint' }, 'Used by Captions, Generate captions. The speech model runs on this device: it downloads the first time (about 250 MB for the accurate one, 80 MB for the balanced one) and then works offline. The accurate model hears more words correctly and times them more closely. Your audio never leaves the device.'),
    field('Speech model', model), field('Processor', compute),
    field('Language', lang),
    field('Caption length', grouping),
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
    const note = h('div', { class: 'stack' });
    const progress = h('progress', { class: 'prog', max: 100, value: 0, style: { display: 'none' } });
    const du = desktopUpdater;
    if (platform === 'electron' && du) {
      const can = await du.check();
      if (can.supported) {
        const go = h('button', { class: 'btn btn-accent' }, 'Download and restart');
        go.addEventListener('click', async () => {
          go.disabled = true;
          progress.style.display = '';
          note.replaceChildren();
          du.onProgress((p) => (progress.value = p));
          try {
            await du.download();
            const done = await du.install();
            if (done && !done.ok) {
              go.disabled = false;
              const cmd = done.command;
              note.replaceChildren(h('p', {}, done.message), ...(cmd ? [h('pre', { class: 'report' }, cmd), h('button', { class: 'btn', onclick: () => navigator.clipboard?.writeText(cmd).then(() => store.say('Command copied.')) }, 'Copy command')] : []));
            }
          } catch (e) {
            go.disabled = false;
            out.append(h('p', {}, `Update failed: ${e instanceof Error ? e.message : e}`));
          }
        });
        return [...rows, go, progress, note];
      }
      rows.push(h('p', { class: 'hint' }, can.reason ?? 'This copy cannot update itself.'));
    }
    if (platform === 'android' && asset && apkUpdater) {
      const apk = apkUpdater;
      const go = h('button', { class: 'btn btn-accent' }, 'Download and install');
      go.addEventListener('click', async () => {
        go.disabled = true;
        progress.style.display = '';
        note.replaceChildren();
        const sub = await apk.addListener('progress', (e) => (progress.value = Math.max(0, e.percent)));
        try {
          await apk.download({ url: asset.url });
          const r = await apk.install();
          note.replaceChildren(h('p', { class: 'hint' }, r && r.needsPermission ? 'Allow TurboCut to install apps on the page that just opened, come back and press the button again.' : 'Android will ask you to confirm the install.'));
        } catch (e) {
          note.replaceChildren(h('p', {}, `Update failed: ${e instanceof Error ? e.message : e}`));
        } finally {
          go.disabled = false;
          void sub.remove();
        }
      });
      return [...rows, go, progress, note];
    }
    if (platform === 'android' && asset) rows.push(h('button', { class: 'btn btn-accent', onclick: () => openApk(asset.url) }, 'Download the update (APK)'));
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
  const sharing = shareApi
    ? panel('Other TurboCut devices',
        check('Let other TurboCut apps on this network find this device', store.settings.shareEnabled, (v) => store.updateSettings({ shareEnabled: v }), 'They can then offer to send you a project. Nothing is saved until you press Accept, and only devices on your own network can reach this one.'),
        field('Name shown to the others', Object.assign(h('input', { class: 'input', value: store.settings.deviceName, placeholder: 'The computer\'s own name', 'aria-label': 'Device name', maxlength: 60 }), { onchange: (e: Event) => store.updateSettings({ deviceName: (e.target as HTMLInputElement).value.trim() }) })),
        h('p', { class: 'hint' }, 'Send a project with File, Send to another device. It uses port 47903 on the network (TCP and UDP); a firewall may ask about it the first time.'))
    : h('span');
  return h('div', { class: 'stack' }, sharing, h('p', { class: 'hint' }, 'What this device can encode and how fast. Copy it into a bug report.'), pre, copy);
}

function about(): HTMLElement {
  return h('div', { class: 'stack' },
    h('p', {}, h('strong', {}, 'TurboCut'), ` ${APP_VERSION}`),
    h('p', { class: 'hint' }, 'A small multi-track video editor with automatic captions. Versions are Year.Month.Update.'),
    h('p', {}, h('a', { href: 'https://github.com/TurboNZL/turbocut', target: '_blank', rel: 'noreferrer' }, 'github.com/TurboNZL/turbocut')),
    h('p', { class: 'hint' }, 'The look comes from turbothemes. TurboCut does not ship third-party fonts: add the fonts you have the right to use.'),
  );
}
