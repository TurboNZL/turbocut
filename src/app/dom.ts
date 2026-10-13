type Child = Node | string | null | undefined | false;

/** Tiny element builder: h('button', { class: 'btn', onclick }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

export const fmtTime = (frames: number, fps: number): string => {
  const total = frames / fps;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const f = Math.floor(frames % fps);
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
};

/** Show a themed dialog (uses the turbothemes `.bt-window` hooks). Resolves nothing; call `close()`. */
export function dialog(title: string, body: Node, buttons: HTMLElement[] = []): { close: () => void; el: HTMLElement } {
  const backdrop = h('div', { class: 'bt-backdrop dlg-backdrop' });
  const close = () => backdrop.remove();
  const win = h(
    'div',
    { class: 'bt-window dlg', role: 'dialog', 'aria-label': title },
    h('div', { class: 'bt-titlebar' }, h('span', {}, title), h('button', { class: 'bt-close', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'bt-body' }, body),
    buttons.length ? h('div', { class: 'bt-footer' }, buttons) : null,
  );
  backdrop.append(win);
  backdrop.addEventListener('pointerdown', (e) => e.target === backdrop && close());
  document.body.append(backdrop);
  return { close, el: win };
}

/** A range slider whose filled part follows the value (turbothemes reads --p). */
export function rangeFill(input: HTMLInputElement): void {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  input.style.setProperty('--p', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}
