/// <reference lib="webworker" />
// Runs Whisper through Transformers.js off the main thread. Loaded only when the user asks for local captions.
import { pipeline } from '@huggingface/transformers';

interface RunMessage {
  type: 'run';
  samples: Float32Array;
  model: string;
  device: 'webgpu' | 'wasm';
  language?: string;
}

const dtypeFor = (device: 'webgpu' | 'wasm') => (device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8');

let loaded: { key: string; asr: any } | null = null;

self.onmessage = async (e: MessageEvent<RunMessage>) => {
  const m = e.data;
  if (m.type !== 'run') return;
  try {
    const key = `${m.model}|${m.device}`;
    if (loaded?.key !== key) {
      const asr = await pipeline('automatic-speech-recognition', m.model, {
        device: m.device,
        // fp32 encoder + 4 bit decoder is the combination Transformers.js documents for WebGPU; q8 for the CPU path.
        dtype: dtypeFor(m.device),
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && typeof p.progress === 'number') (self as any).postMessage({ type: 'download', progress: p.progress / 100, file: p.file });
        },
      } as any);
      loaded = { key, asr };
    }
    (self as any).postMessage({ type: 'transcribing' });
    const out: any = await loaded.asr(m.samples, {
      return_timestamps: 'word',
      // 29, not 30: with 30 s chunks word timestamps collapse near the chunk edge on WebGPU (transformers.js issue 1358).
      chunk_length_s: 29,
      stride_length_s: 5,
      language: m.language,
      task: 'transcribe',
    });
    const words = (out.chunks ?? []).map((c: any, i: number, all: any[]) => {
      const start = c.timestamp?.[0] ?? 0;
      const end = c.timestamp?.[1] ?? all[i + 1]?.timestamp?.[0] ?? start + 0.3;
      return { text: String(c.text).trim(), start, end };
    });
    (self as any).postMessage({ type: 'done', words, info: { model: m.model, device: m.device, dtype: JSON.stringify(dtypeFor(m.device)), language: m.language ?? 'auto-detect', rawText: String(out.text ?? '').slice(0, 600) } });
  } catch (err) {
    (self as any).postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
