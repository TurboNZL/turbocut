import { h, panel } from './dom.ts';
import { activeLayout, editLayout, isCustomLayout } from './layoutStore.ts';
import { AUTO_LAYOUT, BUILTIN_LAYOUTS, LIMITS, MAX_DIVISIONS, TAB_NAMES, column, exportLayout, importLayout, layoutTabs, uniqueDivisionName, uniqueLayoutName, type Density, type Division, type Layout, type PanelPlacement, type Side, type TabName, type ToolsPlacement } from './layout.ts';
import { pickFiles, saveFile } from './platform.ts';
import type { Store } from './store.ts';

const PANELS: [PanelPlacement, string][] = [['auto', 'Automatic (beside the preview on a wide screen, a bottom sheet on a phone)'], ['sheet', 'Always a bottom sheet']];
const DENSITIES: [Density, string][] = [['auto', 'Automatic (large on a touch screen)'], ['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large, for fingers']];
const TOOLS: [ToolsPlacement, string][] = [
  ['auto', 'Automatic (in line with the play button; under the timeline on a phone)'],
  ['top', 'In line with the play button (a row under it on a phone)'],
  ['row', 'A row of their own under the play button'],
  ['bottom', 'Under the timeline'],
  ['left', 'A column left of the preview (not on a phone)'],
  ['right', 'A column right of the preview (not on a phone)'],
  ['float', 'Floating buttons at the bottom right'],
];

const BLURB: Record<string, string> = {
  [AUTO_LAYOUT]: 'One panel on the right; a bottom sheet on a phone.',
  'Library and editor': 'Media and Project on the left, Clip and Captions on the right.',
  'Stacked panels': 'Two named panels in one column on the right.',
  'Bottom sheet': 'The panel slides up from the bottom, even on a wide screen.',
};

const field = (label: string, control: HTMLElement) => h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, label), control);

/** A little drawing of a layout: header, preview, the panels of each side or the sheet, the tool bar, the timeline. It reads the layout itself, so a custom layout is drawn too. */
export function schematic(l: Layout): SVGElement {
  const W = 120;
  const H = 76;
  const head = 6;
  const tools = l.tools === 'bottom' ? 5 : 0;
  const rail = l.tools === 'left' || l.tools === 'right' ? 5 : 0;
  const rest = H - head - tools;
  const tl = Math.round((rest * l.timelineHeight) / 100);
  const main = rest - tl;
  const rects: string[] = [];
  const r = (x: number, y: number, w: number, hh: number, cls: string) => rects.push(`<rect class="${cls}" x="${x}" y="${y}" width="${Math.max(1, w)}" height="${Math.max(1, hh)}" rx="1.5"/>`);
  r(0, 0, W, head - 1, 'sc-bar');
  const wOf = (px: number) => Math.round(18 + ((px - LIMITS.panelWidth[0]) / (LIMITS.panelWidth[1] - LIMITS.panelWidth[0])) * 20);
  if (l.panel === 'sheet') {
    const ph = Math.round(main * 0.42);
    r(2, head + 1, W - 4, main - ph - 3, 'sc-stage');
    r(2, head + main - ph - 1, W - 4, ph, 'sc-panel');
  } else {
    const left = column(l, 'left');
    const right = column(l, 'right');
    const lw = left.length ? wOf(l.leftWidth) : 0;
    const rw = right.length ? wOf(l.panelWidth) : 0;
    const sx = 2 + (lw ? lw + 2 : 0);
    const sw = W - 4 - (lw ? lw + 2 : 0) - (rw ? rw + 2 : 0);
    r(sx + (l.tools === 'left' ? rail + 1.5 : 0), head + 1, sw - (rail ? rail + 1.5 : 0), main - 2, 'sc-stage');
    if (rail) r(l.tools === 'left' ? sx : sx + sw - rail, head + 1, rail, main - 2, 'sc-tools');
    const col = (divs: Division[], x: number, w: number) => {
      const gap = 1.5;
      const total = main - 2 - gap * (divs.length - 1);
      let y = head + 1;
      for (const d of divs) {
        const hh = (total * d.size) / 100;
        r(x, y, w, hh, 'sc-panel');
        y += hh + gap;
      }
    };
    if (left.length) col(left, 2, lw);
    if (right.length) col(right, W - rw - 2, rw);
  }
  if (tools) r(2, head + main + tl, W - 4, tools - 1.5, 'sc-tools');
  r(2, head + main, W - 4, tl - 1, 'sc-tl');
  if (l.tools === 'float') r(W - 14, head + main - 12, 9, 9, 'sc-fab');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'layout-schematic');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = rects.join('');
  return svg;
}

/** The Layout page of Settings: pick a preset, adjust it (an edit makes your own copy), name and arrange your panels, share and delete your own. Changes apply live. */
export function layoutManager(store: Store, redraw: () => void): HTMLElement {
  const s = store.settings;
  const active = activeLayout(store);
  const custom = isCustomLayout(store, active);

  const choose = (name: string) => {
    store.updateSettings({ layout: name });
    redraw();
  };
  const card = (l: Layout, yours: boolean) => {
    const n = l.divisions.length;
    const b = h('button', { class: 'layout-card', type: 'button', role: 'radio', 'aria-checked': String(l.name === active.name), 'data-layout': l.name }, schematic(l), h('span', { class: 'layout-card-name' }, l.name, yours ? h('span', { class: 'chip' }, 'yours') : null), h('span', { class: 'hint' }, BLURB[l.name] ?? `${n} panel${n > 1 ? 's' : ''}.`));
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
  const change = (patch: Partial<Layout>, rebuild = false) => {
    const before = activeLayout(store);
    editLayout(store, patch);
    if (rebuild || activeLayout(store) !== before) redraw(); // a copy was made, or the panels changed: the list and the rows change
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
  const slider = (label: string, value: number, [lo, hi]: readonly [number, number], unit: string, key: 'panelWidth' | 'leftWidth' | 'timelineHeight') => {
    const range = h('input', { type: 'range', class: 'bt-range bt-hit', min: lo, max: hi, value, 'aria-label': label });
    const out = h('span', { class: 'mono' }, `${value}${unit}`);
    range.addEventListener('input', () => {
      out.textContent = `${range.value}${unit}`;
      change({ [key]: Number(range.value) });
    });
    return field(label, h('div', { class: 'row slider-row' }, range, out));
  };

  // ---- the panels: each is its own named box with its tabs, on the left or the right of the preview
  const copyDivs = (): Division[] => active.divisions.map((d) => ({ ...d, tabs: [...d.tabs] }));
  const cleanTabs = (divs: Division[]) => divs.filter((d) => d.tabs.length > 0).map((d) => ({ ...d, size: 0 })); // size 0: equal shares again
  const totalTabs = (divs: Division[]) => divs.reduce((n, d) => n + d.tabs.length, 0);
  const setTab = (index: number, tab: TabName, on: boolean) => {
    const divs = copyDivs();
    for (const d of divs) d.tabs = d.tabs.filter((t) => t !== tab);
    if (on) divs[index]!.tabs = TAB_NAMES.filter((t) => t === tab || divs[index]!.tabs.includes(t));
    if (totalTabs(divs) === 0) return store.say('At least one tab has to stay.'), redraw();
    change({ divisions: cleanTabs(divs) }, true);
  };
  const addPanel = () => {
    const divs = copyDivs();
    if (divs.length >= MAX_DIVISIONS) return store.say(`That is the most panels (${MAX_DIVISIONS}).`);
    const shown = new Set(layoutTabs(active));
    let tab: TabName | undefined = TAB_NAMES.find((t) => !shown.has(t));
    if (!tab) {
      const donor = [...divs].reverse().find((d) => d.tabs.length > 1);
      if (!donor) return store.say('Every tab already has a panel of its own.');
      tab = donor.tabs.pop()!;
    }
    divs.push({ name: uniqueDivisionName('New panel', divs), side: 'right', tabs: [tab], size: 0 });
    change({ divisions: cleanTabs(divs) }, true);
  };
  const panelRow = (d: Division, i: number) => {
    const name = h('input', { class: 'input', value: d.name, 'aria-label': `Name of panel ${i + 1}`, maxlength: 24 });
    name.addEventListener('change', () => {
      const divs = copyDivs();
      divs[i]!.name = uniqueDivisionName(name.value, divs, divs[i]);
      change({ divisions: divs.map((x) => ({ ...x })) }, true);
    });
    const side = h('select', { class: 'input', 'aria-label': `Side of ${d.name}` }, h('option', { value: 'left', selected: d.side === 'left' }, 'Left of the preview'), h('option', { value: 'right', selected: d.side === 'right' }, 'Right of the preview'));
    side.addEventListener('change', () => {
      const divs = copyDivs();
      divs[i]!.side = side.value as Side;
      change({ divisions: divs.map((x) => ({ ...x, size: 0 })) }, true);
    });
    const tabs = TAB_NAMES.map((t) => {
      const box = h('input', { type: 'checkbox', checked: d.tabs.includes(t), 'aria-label': `${t} in ${d.name}` });
      box.addEventListener('change', () => setTab(i, t, box.checked));
      return h('label', { class: 'division-tab' }, box, h('span', {}, t));
    });
    const del = h('button', { class: 'btn btn-ghost', type: 'button', 'aria-label': `Remove ${d.name}`, disabled: active.divisions.length < 2, onclick: () => {
      const divs = copyDivs();
      divs.splice(i, 1);
      change({ divisions: cleanTabs(divs) }, true);
    } }, 'Remove');
    return h('div', { class: 'division', 'data-division': d.name }, h('div', { class: 'division-head' }, name, side, del), h('div', { class: 'division-tabs' }, ...tabs));
  };

  const nameBox = h('input', { class: 'input', value: active.name, 'aria-label': 'Layout name', maxlength: 40 });
  nameBox.addEventListener('change', () => (editLayout(store, { name: nameBox.value }), redraw()));

  const openTab = h('select', { class: 'input', 'aria-label': 'Tab that opens first' }, ...TAB_NAMES.map((t) => h('option', { value: t, selected: s.openTab === t }, t)));
  openTab.addEventListener('change', () => store.updateSettings({ openTab: openTab.value as TabName }));
  const autoSwitch = h('input', { type: 'checkbox', checked: s.autoSwitch, 'aria-label': 'Switch tabs when you select something' });
  autoSwitch.addEventListener('change', () => store.updateSettings({ autoSwitch: autoSwitch.checked }));

  const dock = h('input', { type: 'checkbox', checked: s.dock, 'aria-label': 'Bottom dock with Home, Edit and Settings' });
  dock.addEventListener('change', () => (store.updateSettings({ dock: dock.checked }), redraw()));

  return h('div', { class: 'stack layout-manager' },
    panel('Layouts',
      h('p', { class: 'hint' }, 'Pick one. Drag the bars between the preview, the panels and the timeline to resize them; any change saves your own copy, the presets stay as they are.'),
      presets,
      h('div', { class: 'row' }, exp, imp, remove)),
    panel('Panels',
      h('p', { class: 'hint' }, `Each panel is its own named box beside the preview, on the left or the right, with the tabs you give it. Panels on the same side stack. A tab in no panel is hidden. On a phone everything is one panel under the timeline. ${layoutTabs(active).length} of ${TAB_NAMES.length} tabs shown.`),
      ...(custom ? [] : [h('p', { class: 'hint' }, `Changing anything here saves your own copy of “${active.name}”.`)]),
      h('div', { class: 'divisions' }, ...active.divisions.map(panelRow)),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: addPanel }, 'Add a panel'))),
    panel('Editing tools',
      h('p', { class: 'hint' }, 'Trim, Split, Delete, Text, Snapping and the timeline zoom. Put them where your hand is: beside the play button, in a row of their own, under the timeline, in a column beside the preview, or as floating buttons.'),
      ...(custom ? [] : [h('p', { class: 'hint' }, `Changing this saves your own copy of “${active.name}”.`)]),
      select('Position', TOOLS, active.tools, (v) => change({ tools: v }))),
    panel('Panel behaviour',
      h('label', { class: 'setting' }, dock, h('span', {}, 'Bottom dock with Home, Edit and Settings', h('small', { class: 'hint' }, 'A bar along the bottom of the window, drawn by the look. Settings opens as a page instead of a window. The same switch is in Settings → Look.'))),
      field('Tab that opens first', openTab),
      h('label', { class: 'setting' }, autoSwitch, h('span', {}, 'Switch tabs when you select something', h('small', { class: 'hint' }, 'Selecting a clip shows Clip; selecting a caption shows Captions. Turn this off to stay where you are.')))),
    panel(custom ? `Adjust “${active.name}”` : `Adjust (saves your own copy of “${active.name}”)`,
      ...(custom ? [field('Name', nameBox)] : []),
      select('Panel position', PANELS, active.panel, (v) => change({ panel: v })),
      select('Control size', DENSITIES, active.density, (v) => change({ density: v })),
      slider('Right panel width', active.panelWidth, LIMITS.panelWidth, ' px', 'panelWidth'),
      slider('Left panel width', active.leftWidth, LIMITS.panelWidth, ' px', 'leftWidth'),
      slider('Timeline height', active.timelineHeight, LIMITS.timelineHeight, ' %', 'timelineHeight')));
}
