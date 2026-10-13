import { mixWindow, MIX_WINDOW_SECONDS } from '../export/audio.ts';
import { projectDuration } from '../core/timeline.ts';
import type { Project } from '../core/types.ts';
import type { MediaLibrary } from '../media/library.ts';
import type { Pcm16k } from './provider.ts';

/** Mix the project's audio to 16 kHz mono, the format Whisper wants. 20 minutes is about 77 MB. */
export async function renderPcm16k(p: Project, lib: MediaLibrary, onProgress?: (f: number) => void): Promise<Pcm16k> {
  const seconds = projectDuration(p) / p.fps;
  const samples = new Float32Array(Math.ceil(seconds * 16000));
  for (let w = 0; w < seconds; w += MIX_WINDOW_SECONDS) {
    const buf = await mixWindow(p, lib, w, Math.min(seconds, w + MIX_WINDOW_SECONDS), { rate: 16000, channels: 1 });
    samples.set(buf.getChannelData(0).subarray(0, Math.max(0, samples.length - Math.round(w * 16000))), Math.round(w * 16000));
    onProgress?.(Math.min(1, (w + MIX_WINDOW_SECONDS) / seconds));
  }
  return { samples, sampleRate: 16000 };
}
