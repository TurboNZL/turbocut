import { h } from './dom.ts';
import { icon } from './icons.ts';

interface DesktopWindow {
  customFrame: boolean;
  control(action: 'minimize' | 'maximize' | 'close'): void;
  setCustomFrame(on: boolean): Promise<void>;
  onState(fn: (maximized: boolean) => void): void;
}

/** The desktop shell's window controls, or undefined in a browser and the Android app. */
export const desktopWindow: DesktopWindow | undefined = (globalThis as any).turbocut?.window;

/**
 * The window's title bar, drawn by the theme (the engine's `.bt-wf*` hooks) when the shell asked for a frameless window.
 * Returns null when the system draws the frame.
 */
export function windowFrame(): HTMLElement | null {
  const w = desktopWindow;
  if (!w?.customFrame) return null;
  const maxBtn = h('button', { class: 'bt-wf-btn', type: 'button', 'aria-label': 'Maximise', onclick: () => w.control('maximize') }, icon('maximize', 14));
  w.onState((max) => {
    maxBtn.setAttribute('aria-label', max ? 'Restore' : 'Maximise');
    maxBtn.replaceChildren(icon(max ? 'restore' : 'maximize', 14));
  });
  const stop = (e: Event) => e.stopPropagation();
  for (const b of [maxBtn]) b.addEventListener('dblclick', stop);
  const min = h('button', { class: 'bt-wf-btn', type: 'button', 'aria-label': 'Minimise', onclick: () => w.control('minimize') }, icon('minus', 14));
  const close = h('button', { class: 'bt-wf-btn bt-wf-close', type: 'button', 'aria-label': 'Close', onclick: () => w.control('close') }, icon('close', 14));
  min.addEventListener('dblclick', stop);
  close.addEventListener('dblclick', stop);
  const bar = h('div', { class: 'bt-wf', ondblclick: () => w.control('maximize') }, h('span', { class: 'bt-wf-title' }, 'TurboCut'), h('div', { class: 'bt-wf-btns' }, min, maxBtn, close));
  document.body.classList.add('has-frame');
  return bar;
}
