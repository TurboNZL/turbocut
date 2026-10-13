import { registerAacEncoder } from '@mediabunny/aac-encoder';
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeAudio,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type Quality,
} from 'mediabunny';
import type { CaptionPreset } from '../captions/presets.ts';
import { projectDuration } from '../core/timeline.ts';
import type { Project } from '../core/types.ts';
import type { MediaLibrary } from '../media/library.ts';
import { drawCaption } from '../render/captions.ts';
import { drawVideo } from '../render/compose.ts';
import { MIX_WINDOW_SECONDS, mixWindow } from './audio.ts';

export interface ExportOptions {
  preset?: CaptionPreset | null;
  quality?: Quality;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface ExportResult {
  data: ArrayBuffer;
  mime: string;
  container: 'mp4' | 'webm';
  videoCodec: string;
  audioCodec: string | null;
  frames: number;
  seconds: number;
}

/**
 * Render the project to a file. Prefers H.264 + AAC in MP4 (what the platforms want for shorts) and falls
 * back to VP9/AV1 + Opus in WebM when the runtime has no H.264 encoder (open-source Chromium builds).
 * AAC comes from the platform when it can, otherwise from a WASM encoder.
 */
export async function exportProject(p: Project, lib: MediaLibrary, o: ExportOptions = {}): Promise<ExportResult> {
  const t0 = performance.now();
  const total = projectDuration(p);
  if (total === 0) throw new Error('Nothing to export');
  const hasAudio = p.tracks.some((t) => t.kind === 'audio' && t.clips.length > 0);

  const vcodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], { width: p.width, height: p.height });
  if (!vcodec) throw new Error('This device cannot encode video');
  // The container follows from the video codec, so the two can never disagree: H.264 goes in MP4 with AAC,
  // everything else goes in WebM with Opus.
  const useMp4 = vcodec === 'avc';
  if (hasAudio && useMp4 && !(await canEncodeAudio('aac'))) registerAacEncoder(); // Linux/Electron have no native AAC encoder
  const acodec = hasAudio ? await getFirstEncodableAudioCodec(useMp4 ? ['aac'] : ['opus']) : null;
  if (hasAudio && !acodec) throw new Error('This device cannot encode audio');

  const container = useMp4 ? 'mp4' : 'webm';
  // MP4 holds VP9/AV1 too, but WebM is the safer pairing with Opus.
  const output = new Output({
    format: useMp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  });

  const canvas = new OffscreenCanvas(p.width, p.height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const video = new CanvasSource(canvas, { codec: vcodec, quality: o.quality ?? QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: p.fps });
  const audio = acodec ? new AudioBufferSource({ codec: acodec, quality: o.quality ?? QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const frames = lib.sequential(p);
  const frameCount = total;
  const step = 1 / p.fps;
  try {
    for (let f = 0; f < frameCount; f++) {
      o.signal?.throwIfAborted();
      await drawVideo(ctx, p, f, frames, o.preset ? () => drawCaption(ctx, p, o.preset!, f) : undefined);
      await video.add(f * step, step);
      if (f % 15 === 0) o.onProgress?.((f / frameCount) * (audio ? 0.85 : 1));
    }
  } finally {
    frames.dispose?.();
  }
  video.close();

  if (audio) {
    const seconds = total / p.fps;
    for (let w = 0; w < seconds; w += MIX_WINDOW_SECONDS) {
      o.signal?.throwIfAborted();
      const buf = await mixWindow(p, lib, w, Math.min(seconds, w + MIX_WINDOW_SECONDS));
      await audio.add(buf);
      o.onProgress?.(0.85 + 0.15 * Math.min(1, (w + MIX_WINDOW_SECONDS) / seconds));
    }
    audio.close();
  }

  await output.finalize();
  const data = (output.target as BufferTarget).buffer!;
  return {
    data,
    mime: useMp4 ? 'video/mp4' : 'video/webm',
    container,
    videoCodec: vcodec,
    audioCodec: acodec,
    frames: frameCount,
    seconds: (performance.now() - t0) / 1000,
  };
}
