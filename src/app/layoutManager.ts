import { h, panel } from './dom.ts';
import { activeLayout, editLayout, isCustomLayout } from './layoutStore.ts';
import { AUTO_LAYOUT, BUILTIN_LAYOUTS, LIMITS, MAX_PANES, TAB_NAMES, exportLayout, importLayout, layoutTabs, normalizeSizes, uniqueLayoutName, type Density, type Layout, type PanelPlacement, type TabName, type ToolsPlacement } from './layout.ts';
import { pickFiles, saveFile } from './platform.ts';
import type { Store } from './store.ts';

const PANELS: [PanelPlacement, string][] = [['auto', 'Automatic (right on a wide screen, bottom sheet on a phone)'], ['right', 'Right of the preview'], ['left', 'Left of the preview'], ['sheet', 'Bottom sheet']];
const DENSITIES: [Density, string][] = [['auto', 'Automatic (large on a touch screen)'], ['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large, for fingers']];
const TOOLS: [ToolsPlacement, string][] = [['auto', 'Automatic (above the timeline with a mouse, below it on a phone)'], ['top', 'Above the timeline'], ['bottom', 'Below the timeline']];

const BLURB: Record<string, string> = {
  [AUTO_LAYOUT]: 'One panel on the right; a bottom sheet on a phone.',
  'Panel on the left': 'The same panel, left of the preview.',
  'Tall timeline': 'Half the window for the timeline.',
  'Bottom sheet': 'The panel slides up from the bottom, even on a wide screen.',
  Compact: 'A narrow panel and small controls: more on screen.',
  'Large controls': 'Big buttons and fields, for fingers.',
  'Two panels': 'Clip settings above, Media, Captions and Project below.',
  'Three panels': 'Clip, Media, and Captions with Project, each in its own panel.',
  'Bottom dock': 'The tabs in a dock along the bottom, Settings among them.',
};

const field = (label: string, control: HTMLElement) => h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, label), control);

/** A little drawing of a layout: header, preview, panel(s) or sheet, tools bar, timeline and dock. It reads the layout itself, so a custom layout is drawn too. */
export function schematic(l: Layout): SVGElement {
  const W = 120;
  const H = 76;
  const head = 6;
  const dock = l.dock ? 8 : 0;
  const tools = 5;
  const rest = H - head - dock - tools;
  const tl = Math.round((rest * l.timelineHeight) / 100);
  const main = rest - tl;
  const toolsTop = l.tools !== 'bottom';
  const yMain = head;
  const yTools = toolsTop ? head + main : head + main + tl;
  const yTl = toolsTop ? head + main + tools : head + main;
  const pw = Math.round(22 + ((l.panelWidth - LIMITS.panelWidth[0]) / (LIMITS.panelWidth[1] - LIMITS.panelWidth[0])) * 22);
  const sheet = l.panel === 'sheet';
  const rects: string[] = [];
  const r = (x: number, y: number, w: number, hh: number, cls: string) => rects.push(`<rect class="${cls}" x="${x}" y="${y}" width="${Math.max(1, w)}" height="${Math.max(1, hh)}" rx="1.5"/>`);
  r(0, 0, W, head - 1, 'sc-bar');
  if (sheet) {
    const ph = Math.round(main * 0.42);
    r(2, yMain + 1, W - 4, main - ph - 3, 'sc-stage');
    r(2, yMain + main - ph - 1, W - 4, ph, 'sc-panel');
  } else {
    const left = l.panel === 'left';
    const x0 = left ? 2 : W - pw - 2;
    r(left ? pw + 4 : 2, yMain + 1, W - pw - 6, main - 2, 'sc-stage');
    const gap = 1.5;
    const sizes = normalizeSizes(l.paneSizes, l.panes.length);
    let y = yMain + 1;
    const total = main - 2 - gap * (l.panes.length - 1);
    sizes.forEach((p, i) => {
      const hh = (total * p) / 100;
      r(x0, y, pw, hh, 'sc-panel');
      y += hh + gap;
    });
  }
  r(2, yTools, W - 4, tools - 1.5, 'sc-tools');
  r(2, yTl, W - 4, tl - 1, 'sc-tl');
  if (dock) r(6, H - dock + 1, W - 12, dock - 2, 'sc-dock');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'layout-schematic');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = rects.join('');
  return svg;
}

/** The Layout page of Settings: pick a preset, adjust it (an edit makes your own copy), share and delete your own. Changes apply live. */
export function layoutManager(store: Store, redraw: () => void): HTMLElement {
  const s = store.settings;
  const active = activeLayout(store);
  const custom = isCustomLayout(store, active);

  const choose = (name: string) => {
    store.updateSettings({ layout: name });
    redraw();
  };
  const card = (l: Layout, yours: boolean) => {
    const b = h('button', { class: 'layout-card', type: 'button', role: 'radio', 'aria-checked': String(l.name === active.name), 'data-layout': l.name }, schematic(l), h('span', { class: 'layout-card-name' }, l.name, yours ? h('span', { class: 'chip' }, 'yours') : null), h('span', { class: 'hint' }, BLURB[l.name] ?? `${l.panes.length} panel${l.panes.length > 1 ? 's' : ''}${l.dock ? ', dock' : ''}.`));
    b.addEventListener('click', () => choose(l.name));
    return b;
  };
  const presets = h('div', { class: 'layout-grid', role: 'radiogroup', 'aria-label': 'Layouts' }, ...BUILTIN_LAYOUTS.map((l) => card(l, false)), ...s.layouts.map((l) => card(l, true)));

  const exp = h('button', { class: 'btn', onclick: () => void saveFile(exportLayout(active), `${active.name}.turbocut-layout.json`, 'application/json') }, 'Export this layout');
  const imp = h('button', {
    class: 'btn',
    onclick: async () => {
      for (const f of await pickFiles('.json,application/json', true)) {
        try {
          const l = importLayout(await f.text());
          l.name = uniqueLayoutName(l.name, s.layouts);
          store.updateSettings((x) => {
            x.layouts.push(l);
            x.layout = l.name;
          });
          store.say(`Layout "${l.name}" imported.`);
        } catch (e) {
          store.say(`Not a usable layout: ${e instanceof Error ? e.message : e}`);
        }
      }
      redraw();
    },
  }, 'Import…');
  const remove = h('button', {
    class: 'btn btn-ghost',
    disabled: !custom,
    title: custom ? 'Delete this layout of yours' : 'Presets cannot be deleted',
    onclick: () => {
      store.updateSettings((x) => {
        x.layouts = x.layouts.filter((l) => l !== active);
        x.layout = AUTO_LAYOUT;
      });
      redraw();
    },
  }, 'Delete');

  // Every control below edits the layout in force. On a preset the first edit makes a copy for the person and switches to it.
  const change = (patch: Partial<Layout>) => {
    const before = activeLayout(store);
    editLayout(store, patch);
    if (activeLayout(store) !== before) redraw(); // a copy was made: the list and the name change
    else {
      const cur = activeLayout(store);
      presets.querySelector<HTMLElement>(`[data-layout="${CSS.escape(cur.name)}"] .layout-schematic`)?.replaceWith(schematic(cur));
    }
  };

  const select = <T extends string>(label: string, options: [T, string][], value: T, set: (v: T) => void) => {
    const el = h('select', { class: 'input', 'aria-label': label }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    el.addEventListener('change', () => set(el.value as T));
    return field(label, el);
  };
  const slider = (label: string, value: number, [lo, hi]: readonly [number, number], unit: string, key: 'panelWidth' | 'timelineHeight') => {
    const range = h('input', { type: 'range', class: 'bt-range bt-hit', min: lo, max: hi, value, 'aria-label': label });
    const out = h('span', { class: 'mono' }, `${value}${unit}`);
    range.addEventListener('input', () => {
      out.textContent = `${range.value}${unit}`;
      change({ [key]: Number(range.value) });
    });
    return field(label, h('div', { class: 'row slider-row' }, range, out));
  };

  // Which panel each tab sits in: a small table of radio buttons (a tab in no panel is hidden).
  const where = (t: TabName) => {
    const i = active.panes.findIndex((p) => p.includes(t));
    return i < 0 ? 'hide' : String(i);
  };
  const arrange = (t: TabName, to: string) => {
    const lists: TabName[][] = Array.from({ length: MAX_PANES }, () => []);
    for (const x of TAB_NAMES) {
      const at = x === t ? to : where(x);
      if (at !== 'hide') lists[Number(at)]!.push(x);
    }
    const panes = lists.filter((p) => p.length);
    if (!panes.length) return store.say('At least one tab has to stay.');
    change({ panes, paneSizes: normalizeSizes(null, panes.length) });
  };
  const header = h('div', { class: 'arrange-row arrange-head' }, h('span', {}, ''), ...['Panel 1', 'Panel 2', 'Panel 3', 'Hidden'].map((x) => h('span', {}, x)));
  const rows = TAB_NAMES.map((t) =>
    h('div', { class: 'arrange-row setting' }, h('span', {}, t),
      ...['0', '1', '2', 'hide'].map((v) => {
        const r = h('input', { type: 'radio', name: `where-${t}`, checked: where(t) === v, 'aria-label': `${t} in ${v === 'hide' ? 'no panel' : `panel ${Number(v) + 1}`}` });
        r.addEventListener('change', () => r.checked && arrange(t, v));
        return h('span', {}, r);
      })));

  const name = h('input', { class: 'input', value: active.name, 'aria-label': 'Layout name', maxlength: 40 });
  name.addEventListener('change', () => (editLayout(store, { name: name.value }), redraw()));

  const dock = h('input', { type: 'checkbox', checked: active.dock, 'aria-label': 'Tabs in a dock along the bottom' });
  dock.addEventListener('change', () => change({ dock: dock.checked }));

  return h('div', { class: 'stack layout-manager' },
    panel('Layouts',
      h('p', { class: 'hint' }, 'Pick one. Drag the bars between the preview, the panel and the timeline to resize them; any change saves your own copy, the presets stay as they are.'),
      presets,
      h('div', { class: 'row' }, exp, imp, remove)),
    panel(custom ? `Adjust “${active.name}”` : `Adjust (saves your own copy of “${active.name}”)`,
      ...(custom ? [field('Name', name)] : []),
      select('Panel position', PANELS, active.panel, (v) => change({ panel: v })),
      select('Editing tools', TOOLS, active.tools, (v) => change({ tools: v })),
      select('Control size', DENSITIES, active.density, (v) => change({ density: v })),
      slider('Panel width', active.panelWidth, LIMITS.panelWidth, ' px', 'panelWidth'),
      slider('Timeline height', active.timelineHeight, LIMITS.timelineHeight, ' %', 'timelineHeight'),
      h('label', { class: 'setting' }, dock, h('span', {}, 'Tabs in a dock along the bottom', h('small', { class: 'hint' }, 'Like TurboKeep’s bottom dock. Add Settings as a tab below.')))),
    panel('Panels', h('p', { class: 'hint' }, 'Split the side panel into up to three, each with its own tabs. A tab set to Hidden is not shown (the Settings window still opens with the gear or Ctrl+,).'), header, ...rows, h('p', { class: 'hint' }, `Showing ${layoutTabs(active).length} of ${TAB_NAMES.length} tabs.`)));
}
