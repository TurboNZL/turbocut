import type { Pcm16k, TimedWord, Transcriber, TranscribeOptions } from './provider.ts';

export const MODELS = [
  { id: 'onnx-community/whisper-base_timestamped', label: 'Balanced (base, about 80 MB)' },
  { id: 'onnx-community/whisper-tiny.en_timestamped', label: 'Fast, English only (tiny)' },
  { id: 'onnx-community/whisper-small_timestamped', label: 'Accurate (small, about 250 MB)' },
] as const;
export const DEFAULT_MODEL = MODELS[0].id;

export type Compute = 'auto' | 'webgpu' | 'wasm';

export interface RunInfo {
  model: string;
  device: string;
  dtype: string;
  language: string;
  rawText: string;
}

export async function hasWebGpu(): Promise<boolean> {
  try {
    return !!(await (navigator as any).gpu?.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Whisper running on this device (WebGPU when there is an adapter, otherwise the slower CPU path).
 * The model (about 80 MB for "base") downloads from Hugging Face on first use and is cached by the browser.
 * Status: written against the Transformers.js 4.3.1 types but not yet run end to end, because the
 * development sandbox cannot reach Hugging Face. Treat as untested until checked on a real device.
 */
export class LocalTranscriber implements Transcriber {
  readonly id = 'local';
  readonly label = 'This device';
  private worker: Worker | null = null;
  /** Reported while the model downloads (0..1) or runs. */
  onStatus?: (s: { phase: 'download' | 'transcribing'; progress?: number }) => void;

  /** What the last run actually used and heard, for the copyable report. */
  lastInfo?: RunInfo;

  constructor(private model: string = DEFAULT_MODEL, private compute: Compute = 'auto') {}

  async transcribe(audio: Pcm16k, opts: TranscribeOptions = {}): Promise<TimedWord[]> {
    const device = this.compute === 'auto' ? ((await hasWebGpu()) ? 'webgpu' : 'wasm') : this.compute;
    this.worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        worker.onmessage = null;
        worker.onerror = null;
        opts.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        worker.terminate();
        this.worker = null;
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      opts.signal?.addEventListener('abort', onAbort);
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'download') this.onStatus?.({ phase: 'download', progress: m.progress });
        else if (m.type === 'transcribing') this.onStatus?.({ phase: 'transcribing' });
        else if (m.type === 'done') (cleanup(), (this.lastInfo = m.info), resolve(m.words));
        else if (m.type === 'error') (cleanup(), reject(new Error(m.message)));
      };
      worker.onerror = (e) => (cleanup(), reject(new Error(e.message || 'Transcription worker failed')));
      // Copy: the caller keeps its audio, the worker gets its own buffer.
      const samples = audio.samples.slice();
      worker.postMessage({ type: 'run', samples, model: this.model, device, language: opts.language }, [samples.buffer]);
    });
  }
}
