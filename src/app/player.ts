import { projectDuration } from '../core/timeline.ts';
import { mixWindow } from '../export/audio.ts';
import { drawCaption } from '../render/captions.ts';
import { drawVideo, type FrameSource } from '../render/compose.ts';
import { keepAwake } from './platform.ts';
import type { PreviewFps } from './settings.ts';
import type { Store } from './store.ts';

/** Longest edge of the preview canvas when the size is left on automatic. Smaller than the project to keep editing light; export is always full size. A phone has a small screen and a slow decoder: it gets less. */
const PREVIEW_MAX = 960;
const PREVIEW_MAX_TOUCH = 640;
const STRIDE: Record<Exclude<PreviewFps, 'auto'>, number> = { full: 1, half: 2, third: 3, quarter: 4 };
const touchScreen: { matches: boolean } = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : { matches: false };

/** How many project frames pass per preview frame. Automatic on a touch screen: 30 draws a second at most, which is what phone decoders keep up with. */
export function previewStride(choice: PreviewFps, fps: number, touch: boolean): number {
  if (choice !== 'auto') return STRIDE[choice];
  return touch && fps > 32 ? Math.round(fps / 30) : 1;
}
const AUDIO_WINDOW = 6; // the longest piece of sound mixed in one go, in seconds
const AUDIO_FIRST = 1; // the first piece is short so that playback can start at once
const PREFETCH_SECONDS = 0.75; // how far ahead a clip's decoder is opened

/**
 * Draws the project into a canvas. Paused: random-access decode for the exact frame (latest request wins).
 * Playing: audio is the clock, video follows it from one pipelined decoder per clip, and frames that
 * cannot be drawn in time are skipped rather than slowing playback down.
 */
export class Player {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { alpha: false })!;
  private wanted = -1;
  private busy = false;
  private run = 0; // bumps on every play/pause so stale loops stop
  private audio: AudioContext | null = null;
  private releaseLock: (() => void) | null = null;

  constructor(private store: Store) {
    store.on('playhead', () => !store.playing && this.request(store.playhead));
    store.on('project', () => {
      if (store.playing) this.pause();
      this.layout();
      this.request(store.playhead);
    });
    store.on('preset', () => this.request(store.playhead, true));
    // Preview sharpness and frame rate are settings: redraw at the new size at once.
    let sig = this.previewSig();
    store.on('settings', () => {
      const now = this.previewSig();
      if (now === sig) return;
      sig = now;
      this.layout();
      this.request(store.playhead, true);
    });
    this.layout();
  }

  private previewSig(): string {
    return `${this.store.settings.previewScale}`;
  }

  /** The share of the project's size the preview is drawn at (1 = full): automatic caps the long edge, a number is a percentage. */
  scale(): number {
    const { width, height } = this.store.project;
    const choice = this.store.settings.previewScale;
    return choice === 'auto' ? Math.min(1, (touchScreen.matches ? PREVIEW_MAX_TOUCH : PREVIEW_MAX) / Math.max(width, height)) : choice / 100;
  }

  /** Match the canvas to the project's aspect ratio at preview size. */
  layout(): void {
    const { width, height } = this.store.project;
    const s = this.scale();
    const w = Math.max(2, Math.round(width * s));
    const h = Math.max(2, Math.round(height * s));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
  }

  request(frame: number, force = false): void {
    this.wanted = frame;
    if (force) this.busy = false;
    void this.paused();
  }

  private async paused(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.wanted >= 0 && !this.store.playing) {
        const f = this.wanted;
        this.wanted = -1;
        await this.draw(f, this.store.lib);
      }
    } finally {
      this.busy = false;
    }
  }

  private async draw(frame: number, src: FrameSource): Promise<void> {
    const p = this.store.project;
    await drawVideo(this.ctx, p, frame, src, () => drawCaption(this.ctx, p, this.store.preset, frame));
  }

  async play(): Promise<void> {
    const store = this.store;
    const p = store.project;
    const total = projectDuration(p);
    if (store.playing || total === 0) return;
    if (store.playhead >= total - 1) store.seek(0);
    const token = ++this.run;
    store.playing = true;
    store.emit('play');
    this.releaseLock = await keepAwake();

    const ac = (this.audio ??= new AudioContext());
    await ac.resume();
    const startFrame = store.playhead;
    const startSec = startFrame / p.fps;
    const step = previewStride(store.settings.previewFps, p.fps, touchScreen.matches); // a lower preview rate draws and decodes only every step-th frame

    // Warm up BEFORE the clock starts. The first frame needs a decoder to be opened and brought up to the playhead, and the first
    // piece of sound has to be mixed; on a phone that takes a good fraction of a second. With the clock already running the video
    // started late, found itself "far behind" and threw the decoders away to start again, which is why a resumed play took a while
    // to smooth out.
    let feed = store.lib.sequential(p, startFrame, step);
    const [firstSound] = await Promise.all([mixWindow(p, store.lib, startSec, Math.min(projectDuration(p) / p.fps, startSec + AUDIO_FIRST)), this.draw(startFrame, feed)]);
    if (this.run !== token) {
      feed.dispose?.();
      return;
    }

    // The timer is the system clock, not the audio clock: with no sound device (or a sleeping one) the audio clock can
    // stand still or race, and the video would follow it. Audio starts a little in the future and the video clock is
    // held back by that delay plus the device's output latency, so picture and sound line up.
    const lead = 0.04;
    const latency = lead + ((ac as any).outputLatency || ac.baseLatency || 0);
    const clockStart = ac.currentTime + lead;
    const wall0 = performance.now();
    const now = () => startSec + (performance.now() - wall0) / 1000 - latency;
    void this.scheduleAudio(ac, token, startSec, clockStart, firstSound);

    let next = startFrame + step; // next frame the feed will deliver (the first one is already on screen)
    const ahead = Math.ceil(p.fps * PREFETCH_SECONDS);
    while (this.run === token) {
      const target = Math.min(total - 1, Math.floor(now() * p.fps));
      if (target - next > 8 * step) {
        // Too far behind: restart the decoders at the target instead of grinding through every frame.
        feed.dispose?.();
        feed = store.lib.sequential(p, target, step);
        next = target;
      }
      if (next <= target) {
        feed.prefetch?.(next, ahead); // a clip about to start gets its decoder opened now, not at the cut
        await this.draw(next, feed);
        store.playhead = next;
        store.emit('playhead');
        next += step;
      } else {
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (next >= total) break;
    }
    feed.dispose?.();
    if (this.run === token) this.pause();
  }

  /**
   * Sound is mixed a window at a time. The first window is short and already mixed (it is what lets playback start quickly); each
   * next one is twice as long, up to AUDIO_WINDOW, so every window is mixed while the one before it is still playing.
   */
  private async scheduleAudio(ac: AudioContext, token: number, fromSec: number, clockStart: number, first: AudioBuffer): Promise<void> {
    const p = this.store.project;
    const end = projectDuration(p) / p.fps;
    const put = (buf: AudioBuffer, when: number) => {
      const node = ac.createBufferSource();
      node.buffer = buf;
      node.connect(ac.destination);
      node.start(Math.max(ac.currentTime, when));
      this.sources.push(node);
    };
    put(first, clockStart);
    let len = AUDIO_FIRST;
    for (let t = fromSec + AUDIO_FIRST; t < end && this.run === token; t += len) {
      len = Math.min(AUDIO_WINDOW, len * 2);
      const buf = await mixWindow(p, this.store.lib, t, Math.min(end, t + len));
      if (this.run !== token) return;
      put(buf, clockStart + (t - fromSec));
    }
  }
  private sources: AudioBufferSourceNode[] = [];

  pause(): void {
    this.run++;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.releaseLock?.();
    this.releaseLock = null;
    if (this.store.playing) {
      this.store.playing = false;
      this.store.emit('play');
    }
    this.request(this.store.playhead, true);
  }

  toggle(): void {
    if (this.store.playing) this.pause();
    else void this.play();
  }
}
