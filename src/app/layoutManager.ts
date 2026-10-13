import { h, panel } from './dom.ts';
import { AUTO_LAYOUT, BUILTIN_LAYOUTS, LIMITS, TAB_NAMES, cleanLayout, exportLayout, findLayout, importLayout, uniqueLayoutName, type Density, type Layout, type PanelPlacement, type TabName } from './layout.ts';
import { pickFiles, saveFile } from './platform.ts';
import type { Store } from './store.ts';

const PANELS: [PanelPlacement, string][] = [['auto', 'Automatic (right on a wide screen, bottom sheet on a phone)'], ['right', 'Right of the preview'], ['left', 'Left of the preview'], ['sheet', 'Bottom sheet']];
const DENSITIES: [Density, string][] = [['auto', 'Automatic (large on a touch screen)'], ['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large, for fingers']];

const field = (label: string, control: HTMLElement) => h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, label), control);

/** The Layout page of Settings: choose, make, edit, share and delete editor layouts. Changes apply live. */
export function layoutManager(store: Store, redraw: () => void): HTMLElement {
  const s = store.settings;
  const active = findLayout(s.layout, s.layouts);
  const custom = s.layouts.includes(active);

  const choose = (name: string) => {
    store.updateSettings({ layout: name });
    redraw();
  };
  const save = (l: Layout) => {
    store.updateSettings((x) => {
      const i = x.layouts.findIndex((y) => y === l);
      if (i < 0) x.layouts.push(l);
      x.layout = l.name;
    });
  };

  const pick = h('select', { class: 'input', 'aria-label': 'Layout' },
    h('optgroup', { label: 'Built in' }, ...BUILTIN_LAYOUTS.map((l) => h('option', { value: l.name, selected: l.name === active.name }, l.name))),
    s.layouts.length ? h('optgroup', { label: 'Yours' }, ...s.layouts.map((l) => h('option', { value: l.name, selected: l.name === active.name }, l.name))) : (null as unknown as HTMLElement));
  pick.addEventListener('change', () => choose(pick.value));

  const duplicate = h('button', {
    class: 'btn',
    onclick: () => {
      const copy: Layout = { ...structuredClone(active), name: uniqueLayoutName(custom ? `${active.name} copy` : `My ${active.name.toLowerCase()}`, s.layouts) };
      save(copy);
      redraw();
    },
  }, custom ? 'Duplicate' : 'Duplicate to edit');
  const remove = h('button', {
    class: 'btn btn-ghost',
    disabled: !custom,
    onclick: () => {
      store.updateSettings((x) => {
        x.layouts = x.layouts.filter((l) => l !== active);
        x.layout = AUTO_LAYOUT;
      });
      redraw();
    },
  }, 'Delete');
  const exp = h('button', { class: 'btn', onclick: () => void saveFile(exportLayout(active), `${active.name}.turbocut-layout.json`, 'application/json') }, 'Export');
  const imp = h('button', {
    class: 'btn',
    onclick: async () => {
      for (const f of await pickFiles('.json,application/json', true)) {
        try {
          const l = importLayout(await f.text());
          l.name = uniqueLayoutName(l.name, s.layouts);
          save(l);
          store.say(`Layout "${l.name}" imported.`);
        } catch (e) {
          store.say(`Not a usable layout: ${e instanceof Error ? e.message : e}`);
        }
      }
      redraw();
    },
  }, 'Import…');

  const top: HTMLElement[] = [
    h('p', { class: 'hint' }, 'A layout sets where the side panel sits, how big the panel and timeline are, how large the controls are and which panel tabs show. It applies as you change it.'),
    field('Layout', pick),
    h('div', { class: 'row' }, duplicate, remove, exp, imp),
  ];

  if (!custom) {
    top.push(h('p', { class: 'hint' }, 'Built-in layouts cannot be changed. Duplicate one to make your own.'));
    return h('div', { class: 'stack layout-manager' }, panel('Layout', ...top));
  }

  // Editing: every change replaces the layout in place with a cleaned copy, so the page and the saved list agree.
  const edit = (patch: Partial<Layout>, rebuild = false) => {
    const next = cleanLayout({ ...active, ...patch }, active);
    if (!next) return;
    const unique = next.name === active.name || !([...BUILTIN_LAYOUTS, ...s.layouts].some((l) => l !== active && l.name === next.name));
    if (!unique) next.name = active.name;
    // Change the layout in place: the controls on this page keep pointing at the same object across edits.
    store.updateSettings((x) => {
      Object.assign(active, next);
      x.layout = active.name;
    });
    if (rebuild) redraw();
  };

  const name = h('input', { class: 'input', value: active.name, 'aria-label': 'Layout name', maxlength: 40 });
  name.addEventListener('change', () => edit({ name: name.value }, true));

  const panelSel = h('select', { class: 'input', 'aria-label': 'Panel position' }, ...PANELS.map(([v, l]) => h('option', { value: v, selected: v === active.panel }, l)));
  panelSel.addEventListener('change', () => edit({ panel: panelSel.value as PanelPlacement }));
  const density = h('select', { class: 'input', 'aria-label': 'Control size' }, ...DENSITIES.map(([v, l]) => h('option', { value: v, selected: v === active.density }, l)));
  density.addEventListener('change', () => edit({ density: density.value as Density }));

  const slider = (label: string, value: number, [lo, hi]: readonly [number, number], unit: string, key: 'panelWidth' | 'timelineHeight') => {
    const range = h('input', { type: 'range', class: 'bt-range', min: lo, max: hi, value, 'aria-label': label });
    const out = h('span', { class: 'mono' }, `${value}${unit}`);
    range.addEventListener('input', () => {
      out.textContent = `${range.value}${unit}`;
      edit({ [key]: Number(range.value) });
    });
    return field(label, h('div', { class: 'row' }, range, out));
  };

  const order = [...active.tabs, ...TAB_NAMES.filter((t) => !active.tabs.includes(t))];
  const tabRow = (t: TabName, i: number) => {
    const on = active.tabs.includes(t);
    const box = h('input', { type: 'checkbox', checked: on, 'aria-label': `Show ${t}` });
    box.addEventListener('change', () => edit({ tabs: order.filter((x) => (x === t ? box.checked : active.tabs.includes(x))) }, true));
    const move = (d: number) => {
      const next = [...order];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      edit({ tabs: next.filter((x) => active.tabs.includes(x)) }, true);
    };
    return h('div', { class: 'setting tab-row' },
      h('label', { class: 'setting' }, box, h('span', {}, t)),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost', disabled: i === 0, 'aria-label': `Move ${t} up`, onclick: () => move(-1) }, '↑'),
      h('button', { class: 'btn btn-ghost', disabled: i === order.length - 1, 'aria-label': `Move ${t} down`, onclick: () => move(1) }, '↓'));
  };

  const fields: HTMLElement[] = [
    field('Name', name),
    field('Panel position', panelSel),
    slider('Panel width', active.panelWidth, LIMITS.panelWidth, ' px', 'panelWidth'),
    slider('Timeline height', active.timelineHeight, LIMITS.timelineHeight, ' %', 'timelineHeight'),
    field('Control size', density),
  ];
  return h('div', { class: 'stack layout-manager' },
    panel('Layout', ...top),
    panel('Position and size', ...fields),
    panel('Panel tabs', h('p', { class: 'hint' }, 'Untick a tab to hide it. At least one stays.'), ...order.map(tabRow)));
}
