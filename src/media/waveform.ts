import type { MediaLibrary } from './library.ts';

/** Low-detail waveform: the loudest sample in every 20 ms, mono. 20 minutes of audio is about 60,000 numbers. */
export const PEAKS_PER_SECOND = 50;

export async function computePeaks(lib: MediaLibrary, assetId: string, durationSec: number): Promise<Float32Array> {
  const peaks = new Float32Array(Math.ceil(durationSec * PEAKS_PER_SECOND) + 1);
  for await (const chunk of lib.audioChunks(assetId, 0, durationSec + 1)) {
    const b = chunk.buffer;
    const rate = b.sampleRate;
    const channels = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
    const per = rate / PEAKS_PER_SECOND; // samples per bucket
    for (let i = 0; i < b.length; i++) {
      const idx = Math.floor(chunk.timestamp * PEAKS_PER_SECOND + i / per);
      if (idx < 0 || idx >= peaks.length) continue;
      let v = 0;
      for (const ch of channels) v = Math.max(v, Math.abs(ch[i]!));
      if (v > peaks[idx]!) peaks[idx] = v;
    }
  }
  return peaks;
}

/** Draw `peaks` between two source times into a canvas, scaled to its width. */
export function drawWave(canvas: HTMLCanvasElement, peaks: Float32Array, fromSec: number, toSec: number, color: string): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  const span = Math.max(1e-6, toSec - fromSec);
  for (let x = 0; x < w; x++) {
    const a = Math.floor((fromSec + (x / w) * span) * PEAKS_PER_SECOND);
    const b = Math.max(a + 1, Math.ceil((fromSec + ((x + 1) / w) * span) * PEAKS_PER_SECOND));
    let v = 0;
    for (let i = a; i < b && i < peaks.length; i++) if (i >= 0 && peaks[i]! > v) v = peaks[i]!;
    const half = Math.min(1, v * 1.6) * (h / 2); // speech sits low in the range, so lift it a little
    ctx.fillRect(x, h / 2 - half, 1, Math.max(1, half * 2));
  }
}
