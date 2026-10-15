import { hasWebGpu } from '../transcribe/local.ts';
import { platform } from './platform.ts';

export interface DeviceReport {
  text: string;
}

const yes = (b: boolean) => (b ? 'yes' : 'NO');

async function enc(codec: string, hw: HardwareAcceleration, w: number, h: number): Promise<boolean> {
  try {
    return !!(await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 8e6, framerate: 60, hardwareAcceleration: hw })).supported;
  } catch {
    return false;
  }
}

/** Encode synthetic frames with the first codec that works, to measure real encoder speed on this device. */
async function benchmark(w: number, h: number): Promise<string> {
  const candidates: [string, string][] = [['avc1.640028', 'H.264'], ['vp09.00.10.08', 'VP9'], ['av01.0.04M.08', 'AV1']];
  for (const [codec, label] of candidates) {
    for (const hw of ['prefer-hardware', 'prefer-software'] as const) {
      if (!(await enc(codec, hw, w, h))) continue;
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d')!;
      let bytes = 0;
      let error = '';
      const e = new VideoEncoder({ output: (c) => (bytes += c.byteLength), error: (err) => (error = String(err)) });
      e.configure({ codec, width: w, height: h, bitrate: 8e6, framerate: 60, hardwareAcceleration: hw });
      const N = 45;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) {
        ctx.fillStyle = `hsl(${i * 8} 80% 50%)`;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.fillRect((i * 37) % (w - 200), (i * 61) % (h - 200), 200, 200);
        const f = new VideoFrame(canvas, { timestamp: i * 33333 });
        e.encode(f, { keyFrame: i % 30 === 0 });
        f.close();
        if (e.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      }
      await e.flush();
      e.close();
      const ms = (performance.now() - t0) / N;
      return error ? `${label} (${hw}): failed: ${error}` : `${label} (${hw}): ${ms.toFixed(1)} ms/frame = ${(1000 / ms).toFixed(0)} fps encode only`;
    }
  }
  return 'no video encoder available';
}

/** Collects what matters for TurboCut on this device. Shown in the app and copyable into a bug report. */
export async function deviceCheck(w = 1080, h = 1920): Promise<DeviceReport> {
  const L: string[] = [];
  L.push(`TurboCut device check (${platform})`);
  L.push(`User agent: ${navigator.userAgent}`);
  L.push(`Secure context: ${yes(isSecureContext)}   Cores: ${navigator.hardwareConcurrency}   Memory: ${(navigator as any).deviceMemory ?? '?'} GB`);
  L.push(`WebCodecs: ${yes(typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined')}`);
  if (typeof VideoEncoder === 'undefined') return { text: L.join('\n') };
  L.push(`Size tested: ${w}x${h}`);
  for (const [codec, label] of [['avc1.640028', 'H.264'], ['vp09.00.10.08', 'VP9'], ['av01.0.04M.08', 'AV1']] as const) {
    const [hw, sw] = [await enc(codec, 'prefer-hardware', w, h), await enc(codec, 'prefer-software', w, h)];
    let dec = false;
    try {
      dec = !!(await VideoDecoder.isConfigSupported({ codec })).supported;
    } catch {
      /* unsupported */
    }
    L.push(`${label}: encode hardware-preferred ${yes(hw)}, software ${yes(sw)}, decode ${yes(dec)}`);
  }
  for (const [codec, label] of [['mp4a.40.2', 'AAC'], ['opus', 'Opus']] as const) {
    let ok = false;
    try {
      ok = !!(await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported;
    } catch {
      /* unsupported */
    }
    L.push(`${label} audio encode: ${yes(ok)}`);
  }
  const gpu = await hasWebGpu();
  L.push(`WebGPU adapter: ${yes(gpu)}`);
  if (gpu) {
    try {
      const info = (await (navigator as any).gpu.requestAdapter()).info;
      L.push(`  GPU: ${[info.vendor, info.architecture, info.description].filter(Boolean).join(' ')}`);
    } catch {
      /* ignore */
    }
  }
  L.push(`Canvas filter (blur): ${yes('filter' in OffscreenCanvasRenderingContext2D.prototype)}`);
  L.push(`Benchmark: ${await benchmark(w, h)}`);
  return { text: L.join('\n') };
}
