import { renderMarkdown } from './markdown.ts';
import { dialog, h } from './dom.ts';

// The user guides are the Markdown files in docs/guides, bundled into the app (the engine's rule: docs/guides is for people).
const files = import.meta.glob('../../docs/guides/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface Guide {
  file: string;
  title: string;
  body: string;
}

/** Title table: order and short names. A guide not listed here still shows up, after these, under its own first heading. */
const ORDER = ['GETTING_STARTED.md', 'ANDROID_APK.md', 'CAPTIONS.md', 'STYLES_AND_FONTS.md', 'LAYOUTS_AND_KEYS.md', 'EXPORT.md', 'UPDATES.md', 'WEB_SERVER.md'];

export const guides: Guide[] = Object.entries(files)
  .map(([path, body]) => {
    const file = path.split('/').pop()!;
    return { file, title: /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? file.replace(/\.md$/, ''), body };
  })
  .sort((a, b) => {
    const ia = ORDER.indexOf(a.file);
    const ib = ORDER.indexOf(b.file);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.title.localeCompare(b.title);
  });

/** The guides as a two-pane reader: a list and the open guide. Also used inside Settings. */
export function guidesView(start = ORDER[0]!): HTMLElement {
  const list = h('div', { class: 'guide-list', role: 'tablist', 'aria-orientation': 'vertical' });
  const page = h('article', { class: 'guide-page' });
  const open = (file: string) => {
    const g = guides.find((x) => x.file === file) ?? guides[0];
    if (!g) return;
    for (const b of list.children) (b as HTMLElement).setAttribute('aria-selected', String((b as HTMLElement).dataset.file === g.file));
    page.replaceChildren(renderMarkdown(g.body.replace(/^#\s+.+\n/, ''), { onGuide: open }));
    page.prepend(h('h2', { class: 'guide-title' }, g.title));
    page.scrollTop = 0;
  };
  for (const g of guides) list.append(h('button', { class: 'tab', role: 'tab', 'data-file': g.file, onclick: () => open(g.file) }, g.title));
  open(start);
  return h('div', { class: 'guides' }, list, page);
}

export function openGuides(file?: string): void {
  dialog('Guides', guidesView(file), [], 'dlg-wide');
}
