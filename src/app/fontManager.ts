import { dialog, h } from './dom.ts';
import { fontAvailable, importFont, listFonts, removeFont, type FontEntry } from './fonts.ts';
import { pickFiles } from './platform.ts';
import type { Store } from './store.ts';

const SYSTEM_FONTS = ['Arial Black', 'Impact', 'Arial', 'Verdana', 'Georgia', 'Courier New'];
const SAMPLE = 'Aa Gg Oo 0123 Your captions';

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Where a font name is used: caption styles (all presets) and text layers in the project. */
export function fontUsage(store: Store, family: string): string[] {
  const same = (n: string) => n.toLowerCase() === family.toLowerCase();
  const out: string[] = [];
  for (const p of store.presets) if (p.styles.some((s) => same(s.fontname))) out.push(p.builtin ? `${p.name} (built in)` : p.name);
  let layers = 0;
  for (const t of store.project.tracks) for (const c of t.clips) if (c.text && same(c.text.style.fontname)) layers++;
  if (layers) out.push(`${layers} text layer${layers === 1 ? '' : 's'}`);
  return out;
}

/** Every font name the project's styles and text layers ask for. */
function wantedFonts(store: Store): string[] {
  const names = new Set<string>();
  for (const p of store.presets) for (const s of p.styles) names.add(s.fontname);
  for (const t of store.project.tracks) for (const c of t.clips) if (c.text) names.add(c.text.style.fontname);
  return [...names];
}

/**
 * The font manager: add font files, see each one drawn, choose the default, remove what is not needed, and spot fonts
 * that styles ask for but this device does not have. Fonts live on this device; styles can carry them in their files.
 */
export function openFontManager(store: Store, onClose?: () => void): void {
  const body = h('div', { class: 'font-manager stack' });
  const dlg = dialog('Fonts', body, [h('button', { class: 'btn btn-accent', onclick: () => { dlg.close(); onClose?.(); } }, 'Done')], '');

  const redraw = async () => {
    const entries = await listFonts();
    const defaultFont = store.settings.defaultFont;
    const added = new Set(entries.flatMap((e) => e.families.map((f) => f.toLowerCase())));

    const row = (family: string, extra: Node[], note: string) => {
      const isDefault = family.toLowerCase() === defaultFont.toLowerCase();
      return h('div', { class: 'font-row' },
        h('div', { class: 'font-sample', style: { fontFamily: `"${family}", sans-serif` }, 'aria-hidden': 'true' }, SAMPLE),
        h('div', { class: 'font-meta' },
          h('strong', {}, family, isDefault ? h('span', { class: 'chip' }, 'default') : null),
          h('span', { class: 'hint' }, note)),
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: isDefault, 'aria-label': `Use ${family} as the default font`, onclick: () => { store.updateSettings({ defaultFont: family }); void redraw(); } }, isDefault ? 'Default' : 'Make default'),
          ...extra));
    };

    const userRows = entries.map((e: FontEntry) => {
      const used = e.families.flatMap((f) => fontUsage(store, f));
      const uniq = [...new Set(used)];
      const remove = h('button', {
        class: 'btn btn-ghost',
        'aria-label': `Remove ${e.families[0]}`,
        onclick: async () => {
          if (uniq.length && !confirm(`${e.families[0]} is used by ${uniq.join(', ')}. Remove it anyway? Those will fall back to a plain font until it is added again.`)) return;
          await removeFont(e);
          if (e.families.some((f) => f.toLowerCase() === store.settings.defaultFont.toLowerCase())) store.updateSettings({ defaultFont: SYSTEM_FONTS[0]! });
          store.emit('preset');
          store.emit('project');
          store.say(`Removed ${e.families[0]}.`);
          void redraw();
        },
      }, 'Remove');
      return row(e.families[0]!, [remove], `${e.families.length > 1 ? `Also: ${e.families.slice(1).join(', ')}. ` : ''}${kb(e.size)}. ${uniq.length ? `Used by ${uniq.join(', ')}.` : 'Not used yet.'}`);
    });

    const missing = wantedFonts(store).filter((f) => !added.has(f.toLowerCase()) && !fontAvailable(f));
    const add = h('button', {
      class: 'btn btn-accent',
      onclick: async () => {
        for (const f of await pickFiles('.otf,.ttf,.woff,.woff2,font/*', true)) {
          try {
            const fams = await importFont(f);
            store.say(`Font added: ${fams.join(' / ')}`);
          } catch (e) {
            store.say(`Could not load ${f.name}: ${e instanceof Error ? e.message : e}`);
          }
        }
        store.emit('preset');
        store.emit('project');
        void redraw();
      },
    }, 'Add font files…');

    body.replaceChildren(
      h('p', { class: 'hint' }, 'Fonts you add stay on this device. A caption style can carry its fonts when you export it. Only add fonts you have the right to use.'),
      h('div', { class: 'row' }, add),
      ...(missing.length ? [h('div', { class: 'card bt-panel font-missing' }, h('strong', {}, 'Missing on this device'), h('p', { class: 'hint' }, `${missing.join(', ')}. Styles that use these fall back to a plain font. Add the file, or import a style that carries it.`))] : []),
      h('h3', { class: 'bt-panel-title' }, 'Your fonts'),
      ...(userRows.length ? userRows : [h('p', { class: 'hint' }, 'None yet.')]),
      h('h3', { class: 'bt-panel-title' }, 'Built into most devices'),
      ...SYSTEM_FONTS.filter((f) => fontAvailable(f)).map((f) => row(f, [], 'System font. It may look different on another device.')),
    );
  };
  void redraw();
}
