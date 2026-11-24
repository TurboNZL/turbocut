import type { Pcm16k, TimedWord, Transcriber, TranscribeOptions } from './provider.ts';

export const MODELS = [
  { id: 'onnx-community/whisper-base_timestamped', label: 'Balanced (base, about 80 MB)' },
  { id: 'onnx-community/whisper-tiny.en_timestamped', label: 'Fast, English only (tiny)' },
  { id: 'onnx-community/whisper-small_timestamped', label: 'Accurate (small, about 250 MB)' },
] as const;
export const BALANCED_MODEL: string = MODELS[0].id;
export const ACCURATE_MODEL: string = MODELS[2].id;

/** The model offered first: accurate on a computer (the download is once, the wait is for a short clip), balanced on a phone. */
export const recommendedModel = (touch: boolean): string => (touch ? BALANCED_MODEL : ACCURATE_MODEL);
export const DEFAULT_MODEL = BALANCED_MODEL;

/** The choices shown the first time captions are generated: what each costs and gives. */
export const MODEL_CHOICES: { id: string; name: string; size: string; note: string }[] = [
  { id: 'onnx-community/whisper-tiny.en_timestamped', name: 'Fast', size: 'about 40 MB', note: 'English only. Quickest, and the most mistakes and the loosest timing.' },
  { id: BALANCED_MODEL, name: 'Balanced', size: 'about 80 MB', note: 'Good for clear speech. The best fit for a phone.' },
  { id: ACCURATE_MODEL, name: 'Accurate', size: 'about 250 MB', note: 'Fewer wrong words and tighter timing. Slower, and the better choice on a computer.' },
];

export type Compute = 'auto' | 'webgpu' | 'wasm';

export interface RunInfo {
  model: string;
  device: string;
  dtype: string;
  language: string;
  rawText: string;
}

export async function hasWebGpu(): Promise<boolean> {
  return (await webGpuState()).ok;
}

/**
 * Whether WebGPU can be trusted for the speech model: there has to be a real graphics adapter. A software ("fallback") adapter is slower than the
 * CPU path and a weak one can run out of video memory, which on some systems takes the whole desktop down, so Automatic leaves both to the CPU.
 */
export async function webGpuState(): Promise<{ ok: boolean; why?: string }> {
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) return { ok: false, why: 'This device has no WebGPU.' };
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ok: false, why: 'No graphics adapter answered.' };
    if (adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter) return { ok: false, why: 'WebGPU here is software only, which is slower than the CPU path.' };
    return { ok: true };
  } catch {
    return { ok: false, why: 'WebGPU could not be started.' };
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
  onStatus?: (s: { phase: 'download' | 'transcribing'; progress?: number; note?: string }) => void;

  /** What the last run actually used and heard, for the copyable report. */
  lastInfo?: RunInfo;

  constructor(private model: string = DEFAULT_MODEL, private compute: Compute = 'auto') {}

  async transcribe(audio: Pcm16k, opts: TranscribeOptions = {}): Promise<TimedWord[]> {
    opts.signal?.throwIfAborted();
    const auto = this.compute === 'auto';
    const device: 'webgpu' | 'wasm' = auto ? ((await hasWebGpu()) ? 'webgpu' : 'wasm') : (this.compute as 'webgpu' | 'wasm');
    try {
      return await this.run(device, audio, opts);
    } catch (e) {
      if (opts.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
      this.drop(); // a failed run may have left the graphics memory in a bad state: start the worker over
      const why = e instanceof Error ? e.message : String(e);
      if (device === 'webgpu' && auto) {
        // Automatic never leaves the person with a broken GPU run: say so and do it again on the CPU.
        this.onStatus?.({ phase: 'transcribing', note: 'The graphics chip failed, so this uses the CPU (slower).' });
        return this.run('wasm', audio, opts);
      }
      throw new Error(device === 'webgpu' ? `The graphics chip (WebGPU) failed: ${why.slice(0, 200)} In Settings, Captions, choose Automatic or CPU as the processor.` : why);
    }
  }

  private drop(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private run(device: 'webgpu' | 'wasm', audio: Pcm16k, opts: TranscribeOptions): Promise<TimedWord[]> {
    opts.signal?.throwIfAborted();
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
        if (this.worker === worker) this.worker = null;
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      if (opts.signal?.aborted) return onAbort(); // already cancelled: an 'abort' event would never come
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

/**
 * One transcriber is kept for the session per model and processor, so generating captions again reuses the model that is already loaded
 * (a new worker every time meant reading the whole model in again: it looked like downloading it again).
 */
let shared: { key: string; t: LocalTranscriber } | null = null;
export function sharedTranscriber(model: string, compute: Compute): LocalTranscriber {
  const key = `${model}|${compute}`;
  if (shared?.key !== key) shared = { key, t: new LocalTranscriber(model, compute) };
  return shared.t;
}
