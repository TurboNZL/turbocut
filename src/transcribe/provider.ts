import type { CaptionCue, CaptionWord } from '../core/types.ts';

/** 16 kHz mono float PCM, what Whisper models expect. Every provider takes this. */
export interface Pcm16k {
  samples: Float32Array<ArrayBuffer>;
  sampleRate: 16000;
}

export interface TranscribeOptions {
  language?: string; // ISO code, omit to auto-detect
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface TimedWord {
  text: string;
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
}

/**
 * One interface, several places the model can run:
 *  - local:  Transformers.js + WebGPU inside the app (browser, Electron, Android WebView)
 *  - remote: a TurboCut transcription server on your LAN (desktop GPU) or any machine you trust
 * The editor never knows which one it is talking to.
 */
export interface Transcriber {
  readonly id: string;
  readonly label: string;
  transcribe(audio: Pcm16k, opts?: TranscribeOptions): Promise<TimedWord[]>;
}

/**
 * Wire protocol for a remote server (kept deliberately tiny so a Python or Node server is ~30 lines):
 *   POST {base}/v1/transcribe?language=en
 *   Authorization: Bearer <token>        (optional)
 *   Content-Type: application/octet-stream
 *   body: raw little-endian float32 samples, 16 kHz mono
 *   -> 200 { "words": [ { "text": "hello", "start": 0.12, "end": 0.48 }, ... ] }
 *   GET  {base}/v1/info -> 200 { "name": "...", "model": "..." }
 */
export class RemoteTranscriber implements Transcriber {
  readonly id = 'remote';
  readonly label: string;
  constructor(
    private base: string,
    private token?: string,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.base = base.replace(/\/+$/, '');
    this.label = `Server ${this.base}`;
  }

  async info(): Promise<{ name: string; model: string }> {
    const res = await this.fetchImpl(`${this.base}/v1/info`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Server answered ${res.status}`);
    return res.json();
  }

  async transcribe(audio: Pcm16k, opts: TranscribeOptions = {}): Promise<TimedWord[]> {
    const qs = opts.language ? `?language=${encodeURIComponent(opts.language)}` : '';
    const body = new Blob([audio.samples]);
    const res = await this.fetchImpl(`${this.base}/v1/transcribe${qs}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/octet-stream' },
      body,
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`Transcription server answered ${res.status}`);
    const data = (await res.json()) as { words?: TimedWord[] };
    if (!Array.isArray(data.words)) throw new Error('Transcription server returned no words');
    opts.onProgress?.(1);
    return data.words.filter((w) => typeof w.text === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end));
  }

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }
}

export interface GroupOptions {
  fps: number;
  /** Start a new caption after this many characters. */
  maxChars: number;
  /** ...or after this many words. */
  maxWords: number;
  /** ...or when the speaker pauses this long (seconds). */
  pause: number;
}

export const SHORTS_GROUPING: Omit<GroupOptions, 'fps'> = { maxChars: 18, maxWords: 4, pause: 0.35 };

/** Group word timings into short caption cues, the way vertical-video captions are normally shown. */
export function groupWords(words: TimedWord[], o: GroupOptions, style = 'Default'): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    const ws: CaptionWord[] = cur.map((w) => ({
      text: w.text.trim(),
      start: Math.round(w.start * o.fps),
      end: Math.max(Math.round(w.end * o.fps), Math.round(w.start * o.fps) + 1),
    }));
    cues.push({
      id: `cue_${cues.length}`,
      start: ws[0]!.start,
      end: ws[ws.length - 1]!.end,
      text: ws.map((w) => w.text).join(' '),
      style,
      words: ws,
    });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const len = cur.reduce((n, x) => n + x.text.trim().length + 1, 0) + w.text.trim().length;
    if (prev && (w.start - prev.end >= o.pause || cur.length >= o.maxWords || len > o.maxChars)) flush();
    cur.push(w);
  }
  flush();
  // Close tiny gaps so the caption does not flicker between words that follow each other.
  for (let i = 0; i < cues.length - 1; i++) {
    const a = cues[i]!;
    const b = cues[i + 1]!;
    if (b.start - a.end > 0 && b.start - a.end <= Math.round(o.fps * 0.1)) a.end = b.start;
  }
  return cues;
}
