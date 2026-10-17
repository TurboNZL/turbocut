import { projectDuration } from '../core/timeline.ts';
import { mixWindow } from '../export/audio.ts';
import { drawCaption } from '../render/captions.ts';
import { drawVideo, type FrameSource } from '../render/compose.ts';
import { keepAwake } from './platform.ts';
import type { PreviewFps } from './settings.ts';
import type { Store } from './store.ts';

/** Longest edge of the preview canvas when the size is left on automatic. Smaller than the project to keep editing light; export is always full size. */
const PREVIEW_MAX = 960;
const STRIDE: Record<PreviewFps, number> = { full: 1, half: 2, third: 3, quarter: 4 };
const AUDIO_WINDOW = 6; // seconds mixed ahead of the playhead

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
    return choice === 'auto' ? Math.min(1, PREVIEW_MAX / Math.max(width, height)) : choice / 100;
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
    // The timer is the system clock, not the audio clock: with no sound device (or a sleeping one) the audio clock can
    // stand still or race, and the video would follow it. Audio starts a little in the future and the video clock is
    // held back by that delay plus the device's output latency, so picture and sound line up.
    const lead = 0.04;
    const latency = lead + ((ac as any).outputLatency || ac.baseLatency || 0);
    const clockStart = ac.currentTime + lead;
    const wall0 = performance.now();
    const now = () => startSec + (performance.now() - wall0) / 1000 - latency;
    void this.scheduleAudio(ac, token, startSec, clockStart);

    const step = STRIDE[store.settings.previewFps] ?? 1; // a lower preview rate draws and decodes only every step-th frame
    let feed = store.lib.sequential(p, startFrame, step);
    let next = startFrame; // next frame the feed will deliver
    while (this.run === token) {
      const target = Math.min(total - 1, Math.floor(now() * p.fps));
      if (target - next > 8 * step) {
        // Too far behind: restart the decoders at the target instead of grinding through every frame.
        feed.dispose?.();
        feed = store.lib.sequential(p, target, step);
        next = target;
      }
      if (next <= target) {
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

  private async scheduleAudio(ac: AudioContext, token: number, fromSec: number, clockStart: number): Promise<void> {
    const p = this.store.project;
    const end = projectDuration(p) / p.fps;
    for (let t = fromSec; t < end && this.run === token; t += AUDIO_WINDOW) {
      const buf = await mixWindow(p, this.store.lib, t, Math.min(end, t + AUDIO_WINDOW));
      if (this.run !== token) return;
      const node = ac.createBufferSource();
      node.buffer = buf;
      node.connect(ac.destination);
      node.start(Math.max(ac.currentTime, clockStart + (t - fromSec)));
      this.sources.push(node);
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
