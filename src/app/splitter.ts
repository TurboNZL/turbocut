import { h } from './dom.ts';

export interface SplitterOptions {
  /** `x`: a vertical bar that is dragged sideways; `y`: a horizontal bar dragged up and down. */
  axis: 'x' | 'y';
  label: string;
  /** Called while dragging with how far the pointer has moved since the press (pixels). */
  onDrag: (delta: number) => void;
  /** Called once when the drag (or a keyboard step) is done. */
  onEnd: () => void;
  /** Called when a drag starts, so the caller can remember the size it started from. */
  onStart?: () => void;
  /** Called on a double click (reset to the preset's size). */
  onReset?: () => void;
  extraClass?: string;
}

/**
 * A draggable divider (`role=separator`): pointer drag, arrow keys (16 px a step) and double click to reset. It reports
 * movement only; the caller turns it into a width or a height and saves it.
 */
export function splitter(o: SplitterOptions): HTMLElement {
  const el = h('div', { class: `splitter splitter-${o.axis} ${o.extraClass ?? ''}`.trim(), role: 'separator', 'aria-orientation': o.axis === 'x' ? 'vertical' : 'horizontal', 'aria-label': o.label, title: `${o.label} (drag, or use the arrow keys; double-click to reset)`, tabindex: 0 });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    document.body.classList.add('resizing', `resizing-${o.axis}`);
    o.onStart?.();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => o.onDrag(o.axis === 'x' ? ev.clientX - x0 : ev.clientY - y0);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      document.body.classList.remove('resizing', 'resizing-x', 'resizing-y');
      o.onEnd();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', (e) => {
    const keys: Record<string, number> = o.axis === 'x' ? { ArrowLeft: -16, ArrowRight: 16 } : { ArrowUp: -16, ArrowDown: 16 };
    const d = keys[e.key];
    if (d === undefined) return;
    e.preventDefault();
    o.onStart?.();
    o.onDrag(d);
    o.onEnd();
  });
  if (o.onReset) el.addEventListener('dblclick', () => o.onReset!());
  return el;
}
