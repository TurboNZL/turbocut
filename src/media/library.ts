import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, VideoSampleSink, type InputAudioTrack, type InputVideoTrack, type VideoSample } from 'mediabunny';
import { newId } from '../core/timeline.ts';
import type { Asset, Clip, Frame, Project } from '../core/types.ts';
import { clipEnd } from '../core/timeline.ts';
import { sourceSeconds, type FrameSource, type Picture } from '../render/compose.ts';
import { computePeaks } from './waveform.ts';

interface Opened {
  input: Input;
  video?: InputVideoTrack;
  audio?: InputAudioTrack;
  videoSink?: VideoSampleSink;
  audioSink?: AudioBufferSink;
}

/** Opens media files and hands out decoded frames and audio. Same code on every platform: it only needs a Blob. */
export class MediaLibrary implements FrameSource {
  private opened = new Map<string, Opened>();
  private files = new Map<string, Blob>();
  private peakCache = new Map<string, Promise<Float32Array>>();
  private thumbCache = new Map<string, Promise<HTMLCanvasElement | null>>();

  async importFile(file: Blob, name: string, fps: number): Promise<Asset> {
    const id = newId('a');
    const o = await this.open(id, file, name);
    try {
      await this.checkPicture(o, name);
    } catch (e) {
      this.opened.delete(id);
      this.files.delete(id);
      throw e;
    }
    return {
      id,
      name,
      ref: name,
      hasVideo: !!o.video,
      hasAudio: !!o.audio,
      size: file.size,
      duration: Math.floor((await o.input.computeDuration()) * fps),
      width: o.video ? await o.video.getDisplayWidth() : 0,
      height: o.video ? await o.video.getDisplayHeight() : 0,
    };
  }

  /**
   * A video track this device cannot decode still opens, reads its length and plays its sound: the picture is just black. Say so
   * at import (with the codec, so a report says what it was) instead of leaving a clip that looks broken. The test is the decode
   * itself: `canDecode()` only asks whether the configuration looks supported and can be stricter than the decoder really is, so it
   * is reported (not trusted) when the first frame fails.
   */
  private async checkPicture(o: Opened, name: string): Promise<void> {
    if (!o.video || !o.videoSink) return;
    const codec = (await o.video.getCodec()) ?? 'unknown';
    let reason = '';
    try {
      const frame = await o.videoSink.getSample(await o.video.getFirstTimestamp());
      if (frame) return void frame.close();
      reason = 'gave no frame';
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    const supported = await o.video.canDecode().catch(() => false);
    throw new Error(`the picture of ${name} (${codec}, ${await o.video.getDisplayWidth()}×${await o.video.getDisplayHeight()}) cannot be decoded on this device (${supported ? 'the first frame failed' : 'not supported'}: ${reason}), although its sound and length read fine`);
  }

  private async open(id: string, file: Blob, name: string): Promise<Opened> {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const video = (await input.getPrimaryVideoTrack()) ?? undefined;
    const audio = (await input.getPrimaryAudioTrack()) ?? undefined;
    if (!video && !audio) throw new Error(`${name}: no audio or video track found`);
    const o: Opened = { input, video, audio };
    if (video) o.videoSink = new VideoSampleSink(video);
    if (audio) o.audioSink = new AudioBufferSink(audio);
    this.opened.set(id, o);
    this.files.set(id, file);
    return o;
  }

  /** Give a media entry of a saved project its file again. Drops anything cached from the old file. */
  async relink(id: string, file: Blob, name: string): Promise<void> {
    await this.open(id, file, name);
    this.peakCache.delete(id);
    this.thumbCache.delete(id);
  }

  /** The file an asset was opened from (to send it to another device), or undefined when it is not open. */
  fileFor(id: string): Blob | undefined {
    return this.files.get(id);
  }

  /** True when the media for this asset is open (a project loaded from a file starts with none). */
  has(id: string): boolean {
    return this.opened.has(id);
  }

  /** Forget every file (a different project is being loaded). */
  clear(): void {
    this.opened.clear();
    this.files.clear();
    this.peakCache.clear();
    this.thumbCache.clear();
  }

  /** Random access: right for scrubbing and single frames, but about 10x slower per frame than `sequential` for playback and export. */
  async getFrame(clip: Clip, _frame: Frame, seconds: number): Promise<Picture | null> {
    const o = this.opened.get(clip.assetId);
    if (!o?.videoSink) return null;
    const first = await o.video!.getFirstTimestamp();
    const sample = await o.videoSink.getSample(Math.max(seconds, first));
    return sample ? samplePicture(sample, true) : null;
  }

  /**
   * A frame source for export: each clip gets one pipelined decoder that is pulled strictly in frame order.
   * Measured on a software-only machine: 15 ms/frame this way against 154 ms with `getFrame`.
   */
  sequential(p: Project, startFrame: Frame = 0, stride = 1): FrameSource {
    return new SequentialFrames(this, p, startFrame, stride);
  }

  /** Waveform peaks for an asset, computed once in the background. */
  peaks(assetId: string, durationSec: number): Promise<Float32Array> {
    let p = this.peakCache.get(assetId);
    if (!p) this.peakCache.set(assetId, (p = computePeaks(this, assetId, durationSec)));
    return p;
  }

  /** A small preview picture for the media bin: one frame a little way into the video. */
  thumbnail(assetId: string, width = 160): Promise<HTMLCanvasElement | null> {
    let t = this.thumbCache.get(assetId);
    if (!t) {
      t = (async () => {
        const o = this.opened.get(assetId);
        if (!o?.videoSink || !o.video) return null;
        const first = await o.video.getFirstTimestamp();
        const dur = await o.input.computeDuration();
        const sample = await o.videoSink.getSample(Math.max(first, Math.min(dur * 0.1, dur - 0.1)));
        if (!sample) return null;
        const c = document.createElement('canvas');
        c.width = width;
        c.height = Math.max(1, Math.round((width * sample.displayHeight) / sample.displayWidth));
        sample.draw(c.getContext('2d')!, 0, 0, c.width, c.height);
        sample.close();
        return c;
      })().catch(() => null);
      this.thumbCache.set(assetId, t);
    }
    return t;
  }

  /** @internal */
  videoSinkFor(assetId: string): VideoSampleSink | undefined {
    return this.opened.get(assetId)?.videoSink;
  }

  /** Decoded audio overlapping [from, to) seconds of the source, as AudioBuffers with their start times. */
  async *audioChunks(assetId: string, from: number, to: number) {
    const o = this.opened.get(assetId);
    if (!o?.audioSink) return;
    for await (const b of o.audioSink.buffers(from, to)) yield b;
  }

  dispose(): void {
    for (const o of this.opened.values()) o.input.dispose();
    this.opened.clear();
  }
}

/** A decoded frame as a Picture. `owned` pictures close the frame when the compositor is done with it. */
function samplePicture(sample: VideoSample, owned: boolean): Picture {
  return {
    width: sample.displayWidth,
    height: sample.displayHeight,
    draw: (ctx, dx, dy, dw, dh) => sample.draw(ctx, dx, dy, dw, dh),
    close: owned ? () => sample.close() : undefined,
  };
}

class SequentialFrames implements FrameSource {
  private feeds = new Map<string, { it: AsyncGenerator<VideoSample | null>; next: Frame; last: VideoSample | null }>();

  /** `stride` > 1 is the preview playing at a lower frame rate: only every stride-th frame is asked for, and only those are decoded. */
  constructor(private lib: MediaLibrary, private p: Project, private startFrame: Frame, private stride = 1) {}

  async getFrame(clip: Clip, frame: Frame): Promise<Picture | null> {
    let feed = this.feeds.get(clip.id);
    if (!feed) {
      const sink = this.lib.videoSinkFor(clip.assetId);
      if (!sink) return null;
      const p = this.p;
      const from = Math.max(clip.start, this.startFrame, this.stride > 1 ? frame : 0);
      const stride = this.stride;
      const times = (function* () {
        for (let f = from; f < clipEnd(clip); f += stride) yield Math.max(0, sourceSeconds(p, clip, f));
      })();
      feed = { it: sink.samplesAtTimestamps(times), next: from, last: null };
      this.feeds.set(clip.id, feed);
    }
    if (frame !== feed.next) throw new Error('Sequential source must be read in frame order');
    feed.next += this.stride;
    const r = await feed.it.next();
    // Past the end of the source media the decoder yields nothing: hold the last picture. Only one frame is ever held.
    if (!r.done && r.value) {
      feed.last?.close();
      feed.last = r.value;
    }
    const last = feed.last;
    if (frame + this.stride >= clipEnd(clip)) {
      this.feeds.delete(clip.id);
      void feed.it.return(undefined);
      // The compositor draws this picture after we return, so it is closed by the next call or by dispose.
      if (last) this.finished.push(last);
    }
    return last ? samplePicture(last, false) : null;
  }

  private finished: VideoSample[] = [];

  /** Close the decoders and every frame still held, so no decoded frame is left unclosed. */
  dispose(): void {
    for (const feed of this.feeds.values()) {
      void feed.it.return(undefined);
      feed.last?.close();
    }
    this.feeds.clear();
    for (const s of this.finished) s.close();
    this.finished = [];
  }
}
