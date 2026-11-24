import { setKeyframe } from '../core/keyframes.ts';
import { evalProp } from '../core/keyframes.ts';
import { clipAt } from '../render/compose.ts';
import { textPicture } from '../render/textLayer.ts';
import type { Clip } from '../core/types.ts';
import { popupMenu, type MenuItem } from './dom.ts';
import { PREVIEW_FPS, PREVIEW_SCALES, type PreviewFps, type PreviewScale } from './settings.ts';
import type { Store } from './store.ts';

/**
 * What the person can do with the picture itself: drag a text layer to where it should be, and press and hold (or right click) for the
 * preview's own settings. Playing and pausing is never done by clicking the picture: only the transport buttons do that.
 */
export function canvasInput(canvas: HTMLCanvasElement, store: Store): void {
  canvas.style.touchAction = 'none';

  /** The topmost text layer under the pointer at the playhead, if any. */
  const hit = (clientX: number, clientY: number): Clip | undefined => {
    const p = store.project;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = ((clientX - r.left) / r.width) * p.width;
    const py = ((clientY - r.top) / r.height) * p.height;
    const f = store.playhead;
    for (let i = p.tracks.length - 1; i >= 0; i--) {
      const t = p.tracks[i]!;
      if (t.kind !== 'video' || t.hidden || t.locked) continue;
      const clip = clipAt(t, f);
      if (!clip?.text) continue;
      const pic = textPicture(p, clip, f, true);
      if (!pic) continue;
      const s = evalProp(clip, 'scale', f) || 1;
      const a = (-evalProp(clip, 'rotation', f) * Math.PI) / 180;
      const dx = px - (p.width / 2 + evalProp(clip, 'x', f));
      const dy = py - (p.height / 2 + evalProp(clip, 'y', f));
      const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / s;
      const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / s;
      if (Math.abs(lx) <= pic.width / 2 + 12 && Math.abs(ly) <= pic.height / 2 + 12) return clip;
    }
  };

  const setPos = (clip: Clip, x: number, y: number) => {
    const rel = store.playhead - clip.start;
    for (const [prop, v] of [['x', x], ['y', y]] as const) {
      if (clip.keys[prop]?.length) clip.keys[prop] = setKeyframe(clip.keys[prop], { t: rel, v, ease: 'inOut' });
      else clip.base[prop] = v;
    }
  };

  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    clearTimeout(holdTimer);
    const startX = e.clientX;
    const startY = e.clientY;
    const clip = hit(e.clientX, e.clientY);
    // Press and hold on a phone is the right click: the preview's settings.
    if (e.pointerType !== 'mouse') holdTimer = setTimeout(() => (cleanup(), previewMenu(store, startX, startY)), 550);
    if (!clip) {
      const end = () => (clearTimeout(holdTimer), window.removeEventListener('pointerup', end), window.removeEventListener('pointercancel', end));
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      return;
    }
    e.preventDefault();
    const fromX = evalProp(clip, 'x', store.playhead);
    const fromY = evalProp(clip, 'y', store.playhead);
    const r = canvas.getBoundingClientRect();
    const k = store.project.width / r.width;
    let began = false;
    const move = (ev: PointerEvent) => {
      if (!began && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      clearTimeout(holdTimer);
      if (!began) {
        began = true;
        if (store.selected !== clip.id || store.selectedIds.length !== 1) store.select(clip.id);
        store.begin();
      }
      const cur = store.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
      if (!cur) return;
      setPos(cur, Math.round(fromX + (ev.clientX - startX) * k), Math.round(fromY + (ev.clientY - startY) * k));
      store.emit('project');
    };
    const cleanup = () => {
      clearTimeout(holdTimer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    const up = () => {
      cleanup();
      if (!began) store.select(clip.id); // a plain press on the text selects it
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) canvas.style.cursor = hit(e.clientX, e.clientY) ? 'move' : '';
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (e.pointerType === 'mouse' || (e as PointerEvent).pointerType === undefined) previewMenu(store, e.clientX, e.clientY);
  });
}

const SCALE_NAME = (v: PreviewScale) => (v === 'auto' ? 'Automatic' : v === 100 ? 'Full size' : `${v} %`);
const FPS_NAME: Record<PreviewFps, string> = { auto: 'Automatic', full: 'Every frame', half: 'Every 2nd frame', third: 'Every 3rd frame', quarter: 'Every 4th frame' };

/** The preview's sharpness and frame rate, where the picture is (a right click, or press and hold on a phone). */
export function previewMenu(store: Store, x: number, y: number): void {
  const s = store.settings;
  const items: MenuItem[] = [
    { label: 'Preview sharpness', icon: 'image', run: () => {}, disabled: true },
    ...PREVIEW_SCALES.map((v) => ({ label: `${s.previewScale === v ? '✓ ' : '   '}${SCALE_NAME(v)}`, run: () => store.updateSettings({ previewScale: v }) })),
    { label: 'Preview frame rate', icon: 'gauge', run: () => {}, disabled: true },
    ...PREVIEW_FPS.map((v) => ({ label: `${s.previewFps === v ? '✓ ' : '   '}${FPS_NAME[v]}`, run: () => store.updateSettings({ previewFps: v }) })),
  ];
  popupMenu({ x, y }, items);
}
