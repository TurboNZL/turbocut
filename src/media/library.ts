import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, VideoSampleSink, type InputAudioTrack, type InputVideoTrack, type VideoSample } from 'mediabunny';
import { newId } from '../core/timeline.ts';
import type { Asset, Clip, Frame, Project } from '../core/types.ts';
import { clipEnd } from '../core/timeline.ts';
import { sourceSeconds, type FrameSource, type Picture } from '../render/compose.ts';

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

  async importFile(file: Blob, name: string, fps: number): Promise<Asset> {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const video = (await input.getPrimaryVideoTrack()) ?? undefined;
    const audio = (await input.getPrimaryAudioTrack()) ?? undefined;
    if (!video && !audio) throw new Error(`${name}: no audio or video track found`);
    const id = newId('a');
    const seconds = await input.computeDuration();
    const o: Opened = { input, video, audio };
    if (video) o.videoSink = new VideoSampleSink(video);
    if (audio) o.audioSink = new AudioBufferSink(audio);
    this.opened.set(id, o);
    return {
      id,
      name,
      ref: name,
      hasVideo: !!video,
      hasAudio: !!audio,
      duration: Math.floor(seconds * fps),
      width: video ? await video.getDisplayWidth() : 0,
      height: video ? await video.getDisplayHeight() : 0,
    };
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
  sequential(p: Project, startFrame: Frame = 0): FrameSource {
    return new SequentialFrames(this, p, startFrame);
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

  constructor(private lib: MediaLibrary, private p: Project, private startFrame: Frame) {}

  async getFrame(clip: Clip, frame: Frame): Promise<Picture | null> {
    let feed = this.feeds.get(clip.id);
    if (!feed) {
      const sink = this.lib.videoSinkFor(clip.assetId);
      if (!sink) return null;
      const p = this.p;
      const from = Math.max(clip.start, this.startFrame);
      const times = (function* () {
        for (let f = from; f < clipEnd(clip); f++) yield Math.max(0, sourceSeconds(p, clip, f));
      })();
      feed = { it: sink.samplesAtTimestamps(times), next: from, last: null };
      this.feeds.set(clip.id, feed);
    }
    if (frame !== feed.next) throw new Error('Sequential source must be read in frame order');
    feed.next++;
    const r = await feed.it.next();
    // Past the end of the source media the decoder yields nothing: hold the last picture. Only one frame is ever held.
    if (!r.done && r.value) {
      feed.last?.close();
      feed.last = r.value;
    }
    const last = feed.last;
    if (frame === clipEnd(clip) - 1) {
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
