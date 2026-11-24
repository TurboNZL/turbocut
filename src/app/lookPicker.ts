import { effectiveUi, getEngine, resolveTheme, themeStyle } from 'turbothemes';
import { h, panel } from './dom.ts';
import { icon } from './icons.ts';
import { UI_SCALE } from './settings.ts';
import type { Store } from './store.ts';
import { desktopWindow } from './windowFrame.ts';

type Tone = 'all' | 'dark' | 'light';

/**
 * A small mock of the editor drawn with the real hook classes, coloured by `theme` and shaped by `ui` (not by the page's own look), so every
 * combination can be seen before choosing it. It is a picture: hovering an option moves it, nothing on the real page changes until a click.
 */
function mockEditor(): { el: HTMLElement; show(theme: string, ui: string): void } {
  const tabs = ['Clip', 'Media', 'Captions'].map((t, i) => h('span', { class: 'tab', role: 'tab', 'aria-selected': String(i === 0) }, t));
  const el = h('div', { class: 'look-mock', role: 'img', 'aria-label': 'Preview of the chosen colours and style' },
    h('div', { class: 'bt-top look-mock-top' }, h('strong', {}, 'TurboCut'), h('span', { class: 'btn btn-ghost' }, 'File'), h('span', { class: 'spacer' }), h('span', { class: 'btn btn-accent' }, 'Export')),
    h('div', { class: 'look-mock-main' },
      h('div', { class: 'look-mock-video' }, h('span', { class: 'look-mock-playhead' })),
      h('div', { class: 'bt-shell look-mock-side' },
        h('div', { class: 'tabs', role: 'tablist' }, ...tabs),
        h('div', { class: 'look-mock-fields' },
          h('div', { class: 'input' }, 'Zoom  1.2'),
          h('input', { type: 'range', class: 'bt-range', value: '62', min: '0', max: '100', tabindex: '-1', 'aria-hidden': 'true', style: { '--p': '62%' } as unknown as Record<string, string> } as Record<string, unknown>),
          h('div', { class: 'row' }, h('span', { class: 'btn' }, 'Cancel'), h('span', { class: 'btn btn-accent' }, 'Save'), h('span', { class: 'chip' }, '0:04'))))),
    h('div', { class: 'look-mock-tl' }, h('span', { class: 'look-mock-clip' }), h('span', { class: 'look-mock-clip b' })),
    h('div', { class: 'bt-window look-mock-dialog' }, h('div', { class: 'bt-titlebar' }, h('h2', {}, 'Export'), h('span', { class: 'bt-close' }, '×')), h('div', { class: 'bt-body' }, 'Dialogs and menus follow the style too.')));
  const sliderEl = el.querySelector<HTMLInputElement>('input[type=range]');
  if (sliderEl) sliderEl.style.setProperty('--p', '62%');
  return {
    el,
    show(theme, ui) {
      const def = resolveTheme(theme);
      el.dataset.theme = def.id;
      el.dataset.ui = effectiveUi(ui);
      el.dataset.mode = def.dark ? 'dark' : 'light';
      el.removeAttribute('style');
      for (const [k, v] of Object.entries(themeStyle(theme))) k.startsWith('--') ? el.style.setProperty(k, String(v)) : ((el.style as unknown as Record<string, string>)[k] = String(v));
    },
  };
}

/**
 * The Look page, built on the theme engine's headless picker (the same pieces TurboKeep and TurboMusic use): a preview that stays beside the
 * lists, a light/dark filter, colour chips in a grid with their own swatches, UI styles with a line about the one under the pointer, "use
 * matching colours", wallpaper, the size of the whole interface, theme updates, and how the window is drawn.
 */
export function lookPicker(store: Store, redraw: () => void): HTMLElement {
  const picker = getEngine().picker();
  const mock = mockEditor();
  let tone: Tone = 'all';
  let hoverTheme: string | null = null;
  let hoverUi: string | null = null;
  const now = () => picker.getState().appearance;

  const caption = h('span', { class: 'look-now' });
  const syncMock = () => {
    const a = now();
    const theme = hoverTheme ?? a.theme;
    const ui = hoverUi ?? a.ui;
    mock.show(theme, ui);
    const names = (id: string, list: { id: string; label: string }[]) => list.find((x) => x.id === id)?.label ?? id;
    const themeLabel = names(theme, picker.themes().flatMap((g) => g.items));
    const uiLabel = names(ui, picker.styles());
    caption.textContent = `${themeLabel} + ${uiLabel}`;
  };

  // ---------------------------------------------------------------- colours
  const swatch = (c: { bg: string; surface: string; accent: string; text: string } | null) =>
    h('span', { class: 'look-sw', 'aria-hidden': 'true' }, ...(c ? [c.bg, c.surface, c.accent, c.text].map((x) => h('i', { style: { background: x } })) : [h('i', { class: 'look-auto' })]));
  const themeBox = h('div', { class: 'look-groups' });
  const drawThemes = () => {
    const a = now();
    themeBox.replaceChildren(
      ...picker.themes(tone).filter((g) => g.items.length).map((g) => h('div', { class: 'look-group' },
        h('h3', { class: 'look-h' }, g.label),
        h('div', { class: 'look-grid', role: 'radiogroup', 'aria-label': g.label, onmouseleave: () => ((hoverTheme = null), syncMock()) },
          ...g.items.map((t) => {
            const on = a.theme === t.id;
            const b = h('button', { type: 'button', class: `look-chip${on ? ' on' : ''}`, role: 'radio', 'aria-checked': String(on), title: t.note ? `${t.label}: ${t.note}` : t.label, 'data-theme-id': t.id }, swatch(t.colors), h('span', { class: 'look-name' }, t.label), ...(on ? [icon('check', 12)] : []));
            b.addEventListener('mouseenter', () => ((hoverTheme = t.id), syncMock()));
            b.addEventListener('focus', () => ((hoverTheme = t.id), syncMock()));
            b.addEventListener('blur', () => ((hoverTheme = null), syncMock()));
            b.addEventListener('click', () => picker.set({ theme: t.id }));
            return b;
          })))));
  };
  const toneBtns = (['all', 'dark', 'light'] as Tone[]).map((t) => h('button', { type: 'button', class: 'look-tone', 'aria-pressed': String(tone === t), onclick: () => ((tone = t), drawThemes(), toneBtns.forEach((b, i) => b.setAttribute('aria-pressed', String((['all', 'dark', 'light'] as Tone[])[i] === tone)))) }, t === 'all' ? 'All' : t === 'dark' ? 'Dark' : 'Light'));

  // ---------------------------------------------------------------- UI styles
  const uiBox = h('div', { class: 'look-grid look-grid-wide', role: 'radiogroup', 'aria-label': 'UI style', onmouseleave: () => ((hoverUi = null), syncMock(), drawUiNote()) });
  const uiNote = h('p', { class: 'look-note', 'aria-live': 'polite' });
  const matchBtn = h('button', { type: 'button', class: 'btn', onclick: () => picker.useMatchingTheme() });
  const glassBox = h('div', { class: 'row look-glass' });
  const drawUiNote = () => {
    const styles = picker.styles();
    const id = hoverUi ?? now().ui;
    const s = styles.find((x) => x.id === id);
    uiNote.replaceChildren(h('strong', {}, `${s?.label ?? id}: `), s?.description ?? '', ...(s?.isAuto ? [` On this device that is ${picker.device().name}.`] : []));
  };
  const drawUi = () => {
    const a = now();
    uiBox.replaceChildren(...picker.styles().map((s) => {
      const on = a.ui === s.id;
      const b = h('button', { type: 'button', class: `look-chip look-style${on ? ' on' : ''}`, role: 'radio', 'aria-checked': String(on), title: s.description, 'data-ui-id': s.id }, h('span', { class: 'look-name' }, s.label), ...(on ? [icon('check', 12)] : []));
      b.addEventListener('mouseenter', () => ((hoverUi = s.id), syncMock(), drawUiNote()));
      b.addEventListener('focus', () => ((hoverUi = s.id), syncMock(), drawUiNote()));
      b.addEventListener('blur', () => ((hoverUi = null), syncMock(), drawUiNote()));
      b.addEventListener('click', () => picker.set({ ui: s.id }));
      return b;
    }));
    drawUiNote();
    const matching = picker.matchingTheme();
    const label = matching ? picker.themes().flatMap((g) => g.items).find((t) => t.id === matching)?.label : undefined;
    matchBtn.hidden = !matching || matching === a.theme;
    matchBtn.replaceChildren(icon('check', 14), `Use matching colours${label ? ` (${label})` : ''}`);
    matchBtn.onmouseenter = () => ((hoverTheme = matching), syncMock());
    matchBtn.onmouseleave = () => ((hoverTheme = null), syncMock());
    glassBox.hidden = effectiveUi(a.ui) !== 'liquid';
    glassBox.replaceChildren(h('span', { class: 'prop-l' }, 'Glass'), ...(['regular', 'clear'] as const).map((g) => h('button', { type: 'button', class: 'look-tone', 'aria-pressed': String((a.glass ?? 'regular') === g), onclick: () => picker.set({ glass: g }) }, g === 'regular' ? 'Regular' : 'Clear')));
  };

  // ---------------------------------------------------------------- wallpaper
  const wall = h('div', { class: 'stack' });
  const drawWall = () => {
    const a = now();
    const dark = h('input', { type: 'range', class: 'bt-range', min: '0', max: '90', value: String(Math.round((a.wallpaperDarkness ?? 0.35) * 100)), 'aria-label': 'Wallpaper darkness', disabled: !a.wallpaper });
    dark.addEventListener('input', () => picker.set({ wallpaperDarkness: Number(dark.value) / 100 }));
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Choose a wallpaper picture' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) await picker.wallpaper.setCustom(f).then(() => picker.set({ wallpaper: true, wallpaperCustom: true })).catch((e) => store.say(e instanceof Error ? e.message : 'Could not load that picture'));
    });
    wall.replaceChildren(
      h('label', { class: 'setting' }, Object.assign(h('input', { type: 'checkbox', checked: !!a.wallpaper }), { onchange: (e: Event) => picker.set({ wallpaper: (e.target as HTMLInputElement).checked }) }), h('span', {}, 'Show a wallpaper behind the panels', h('small', { class: 'hint' }, 'Each colour theme has its own, or load a picture of your own. The panels turn slightly see-through.'))),
      h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, 'Darkness'), dark),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, picker.wallpaper.hasCustom() ? 'Choose another picture…' : 'Load a picture…'), file,
        ...(picker.wallpaper.hasCustom() ? [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => (picker.wallpaper.clearCustom(), picker.set({ wallpaperCustom: false })) }, 'Remove my picture')] : [])));
  };

  // ---------------------------------------------------------------- size of the interface
  const scaleOut = h('span', { class: 'mono' }, `${store.settings.uiScale} %`);
  const scale = h('input', { type: 'range', class: 'bt-range', min: String(UI_SCALE.min), max: String(UI_SCALE.max), step: '5', value: String(store.settings.uiScale), 'aria-label': 'Interface size' });
  scale.addEventListener('input', () => ((scaleOut.textContent = `${scale.value} %`), store.updateSettings({ uiScale: Number(scale.value) })));

  // ---------------------------------------------------------------- theme updates
  const updNote = h('p', { class: 'hint' });
  const version = () => {
    const v = picker.version();
    updNote.textContent = `Themes in use: ${v.origin === 'downloaded' ? 'downloaded' : 'built into this version of TurboCut'}${v.checkedAt ? `, last checked ${new Date(v.checkedAt).toLocaleDateString()}` : ''}.`;
  };
  version();
  const checkBtn = h('button', { class: 'btn', type: 'button' }, 'Check for newer themes now');
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    updNote.textContent = 'Checking…';
    const r = await picker.checkForUpdates();
    updNote.textContent = r.message;
    checkBtn.disabled = false;
  });
  const w = desktopWindow;

  const redrawAll = () => {
    drawThemes();
    drawUi();
    drawWall();
    syncMock();
  };
  redrawAll();
  let wasConnected = false;
  const off = picker.subscribe(() => {
    if (root.isConnected) wasConnected = true;
    else if (wasConnected) return off();
    redrawAll();
  });

  const check = (label: string, on: boolean, set: (v: boolean) => void, hint?: string) => {
    const box = h('input', { type: 'checkbox', checked: on });
    box.addEventListener('change', () => set(box.checked));
    return h('label', { class: 'setting' }, box, h('span', {}, label, hint ? h('small', { class: 'hint' }, hint) : null));
  };

  const root = h('div', { class: 'look-page' },
    h('div', { class: 'look-side' }, h('div', { class: 'look-preview' }, h('div', { class: 'look-preview-head' }, h('span', { class: 'look-badge' }, 'Preview'), caption), mock.el, h('p', { class: 'hint look-preview-note' }, 'Not your real page. Hover an option to try it, click to apply.'))),
    h('div', { class: 'stack look-lists' },
      panel('Colour theme',
        h('div', { class: 'look-toolbar' }, h('p', { class: 'hint' }, 'Colours only: the accent comes from the theme. Any colours work with any UI style.'), h('div', { class: 'look-tones', role: 'group', 'aria-label': 'Show' }, ...toneBtns)),
        themeBox),
      panel('UI style',
        h('p', { class: 'hint' }, 'Shape, type, depth and motion: how buttons, menus, dialogs and the bars look and move.'),
        h('div', { class: 'row' }, matchBtn),
        uiBox, uiNote, glassBox),
      panel('Wallpaper', wall),
      panel('Size', h('p', { class: 'hint' }, 'Makes the whole interface bigger or smaller: text, buttons and panels. The size of the controls inside the panels alone is in Settings, Layout.'),
        h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, 'Interface size'), h('div', { class: 'row slider-row' }, scale, scaleOut)),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => (store.updateSettings({ uiScale: 100 }), redraw()) }, 'Back to 100 %')),
      panel('Theme updates',
        check('Download newer themes in the background', store.settings.themeUpdates, (v) => store.updateSettings({ themeUpdates: v }), 'Off by default. A download replaces the themes that came with this version, so looks added since the downloadable pack was built can disappear. Takes effect the next time TurboCut starts.'),
        checkBtn, updNote, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => (picker.resetThemes(), version()) }, 'Go back to the built-in themes')),
      panel('Window',
        check('Bottom dock with Home, Edit and Settings', store.settings.dock, (v) => (store.updateSettings({ dock: v }), redraw()), 'A bar along the bottom of the window, drawn by the look. Settings opens as a page instead of a window.'),
        ...(w ? [check('Draw the title bar from the theme', w.customFrame, (v) => void w.setCustomFrame(v), 'Applies after TurboCut restarts. Turn it off to use your desktop\'s own title bar; macOS always uses its own.')] : []))));
  return root;
}
