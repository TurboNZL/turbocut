import { h } from './dom.ts';
import { icon } from './icons.ts';
import { fontChoices } from './fonts.ts';

export interface FontPickerOptions {
  value: string;
  ariaLabel: string;
  placeholder?: string;
  /** Called on every change of the name, typed or picked (the style is already live-edited that way). */
  onInput: (name: string) => void;
  /** Called once the person is done with a burst of edits (picked, or left the box). */
  onCommit?: () => void;
}

const MAX_SHOWN = 120;

/**
 * A font box with a drop-down drawn by the theme (`bt-menu`, `role=listbox`), not the browser's native list. Each name is shown in
 * its own font; typing filters the list; any name can be typed, because a document may name a font this device lacks.
 */
export function fontPicker(o: FontPickerOptions): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { class: 'input font-input', type: 'text', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-label': o.ariaLabel, placeholder: o.placeholder ?? 'Font name', value: o.value, autocomplete: 'off', spellcheck: false });
  const toggle = h('button', { class: 'btn btn-ghost font-toggle', type: 'button', tabindex: -1, 'aria-label': `Show ${o.ariaLabel.toLowerCase()} list` }, icon('chevron', 14));
  const el = h('div', { class: 'font-picker' }, input, toggle);

  let menu: HTMLElement | null = null;
  let hi = -1;
  let options: string[] = [];

  const close = () => {
    menu?.remove();
    menu = null;
    hi = -1;
    input.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', away, true);
    window.removeEventListener('resize', close);
  };
  const away = (e: Event) => {
    if (!menu?.contains(e.target as Node) && !el.contains(e.target as Node)) close();
  };

  const place = () => {
    if (!menu) return;
    const r = input.getBoundingClientRect();
    const w = Math.max(r.width + toggle.offsetWidth, 220);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 200 && above > below;
    menu.style.minWidth = `${w}px`;
    menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`;
    menu.style.maxHeight = `${Math.max(120, Math.min(320, up ? above : below))}px`;
    menu.style.top = up ? `${Math.max(4, r.top - menu.offsetHeight - 4)}px` : `${r.bottom + 4}px`;
  };

  const draw = (filter: string) => {
    const q = filter.trim().toLowerCase();
    const all = fontChoices();
    options = all.filter((f) => !q || f.toLowerCase().includes(q)).slice(0, MAX_SHOWN);
    if (!menu) return;
    menu.replaceChildren(
      ...options.map((name, i) => {
        const opt = h('div', { class: 'font-option', role: 'option', 'aria-selected': String(name.toLowerCase() === input.value.trim().toLowerCase()), id: `fo-${i}` }, h('span', { style: { fontFamily: `"${name}", sans-serif` } }, name));
        opt.addEventListener('pointerdown', (e) => {
          e.preventDefault(); // keep the focus in the box
          pick(name);
        });
        return opt;
      }),
      ...(options.length === 0 ? [h('div', { class: 'font-none hint' }, q ? `No installed font matches "${filter.trim()}". Press Enter to use that name anyway.` : 'No fonts to list yet.')] : []),
    );
    hi = -1;
    place();
  };

  const open = () => {
    if (menu) return;
    menu = h('div', { class: 'bt-menu font-menu', role: 'listbox', 'aria-label': `${o.ariaLabel} list` });
    document.body.append(menu);
    input.setAttribute('aria-expanded', 'true');
    // Show the whole list when opening; filter only once something is typed.
    draw('');
    const current = options.findIndex((n) => n.toLowerCase() === input.value.trim().toLowerCase());
    if (current >= 0) mark(current);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', close);
  };

  const mark = (i: number) => {
    hi = i;
    menu?.querySelectorAll('.font-option').forEach((n, k) => n.classList.toggle('bt-select-hi', k === i));
    menu?.querySelectorAll('.font-option')[i]?.scrollIntoView({ block: 'nearest' });
  };

  const pick = (name: string) => {
    input.value = name;
    o.onInput(name);
    o.onCommit?.();
    close();
  };

  input.addEventListener('focus', () => open());
  input.addEventListener('click', () => open());
  input.addEventListener('input', () => {
    open();
    draw(input.value);
    o.onInput(input.value.trim());
  });
  input.addEventListener('change', () => o.onCommit?.());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
      if (!options.length) return;
      mark(e.key === 'ArrowDown' ? Math.min(options.length - 1, hi + 1) : Math.max(0, hi - 1));
    } else if (e.key === 'Enter') {
      if (menu && hi >= 0 && options[hi]) {
        e.preventDefault();
        pick(options[hi]!);
      } else close();
    } else if (e.key === 'Escape' && menu) {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close();
  });
  toggle.addEventListener('pointerdown', (e) => e.preventDefault());
  toggle.addEventListener('click', () => (menu ? close() : (input.focus(), open())));
  return { el, input };
}
