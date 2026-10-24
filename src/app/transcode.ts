import { UndecodablePicture } from '../media/library.ts';

interface DesktopTranscode {
  available(): Promise<boolean>;
  begin(name: string): Promise<string>;
  write(id: string, bytes: Uint8Array): Promise<{ ok: boolean; message?: string }>;
  run(id: string, onProgress: (f: number) => void): Promise<{ ok: true; name: string; url: string } | { ok: false; cancelled: boolean; message: string }>;
  cancel(id: string): void;
  done(id: string): void;
}

const desktop: DesktopTranscode | undefined = (globalThis as any).turbocut?.transcode;
const CHUNK = 4 * 1024 * 1024;

/** True in the desktop app: it can convert a video this computer cannot decode, when ffmpeg is installed. */
export const canTranscodeHere = (): boolean => !!desktop;

export async function ffmpegInstalled(): Promise<boolean> {
  return desktop ? desktop.available().catch(() => false) : false;
}

/**
 * Run `open` on the file; when its picture cannot be decoded here and the desktop shell has ffmpeg, convert it to H.264 and run `open`
 * on that copy (named like the original, so a project still finds it). `say` reports what is happening. Throws what `open` threw, with
 * a way forward added when conversion is the answer but impossible.
 */
export async function openWithConversion<T>(file: File, open: (f: File) => Promise<T>, say: (m: string) => void, signal?: AbortSignal): Promise<T> {
  try {
    return await open(file);
  } catch (e) {
    if (!(e instanceof UndecodablePicture) || !desktop) throw e;
    if (!(await ffmpegInstalled())) throw new Error(`${e.message}. TurboCut can convert it when ffmpeg is installed (Linux: sudo apt install ffmpeg; Windows: winget install ffmpeg), then import it again`);
    const converted = await convert(file, e.codec, say, signal);
    return open(converted);
  }
}

async function convert(file: File, codec: string, say: (m: string) => void, signal?: AbortSignal): Promise<File> {
  const d = desktop!;
  const id = await d.begin(file.name);
  const stop = () => d.cancel(id);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    for (let at = 0; at < file.size; at += CHUNK) {
      say(`Preparing ${file.name} (${codec}) to be converted… ${Math.round((at / file.size) * 100)}%`);
      const w = await d.write(id, new Uint8Array(await file.slice(at, at + CHUNK).arrayBuffer()));
      if (!w.ok) throw new Error(w.message || 'Could not hand the file to the converter.');
    }
    say(`Converting ${file.name} (${codec}) so this computer can show it…`);
    const r = await d.run(id, (f) => say(`Converting ${file.name} (${codec}) so this computer can show it… ${Math.round(f * 100)}%`));
    if (!r.ok) throw r.cancelled ? new DOMException('Cancelled', 'AbortError') : new Error(r.message);
    const blob = await (await fetch(r.url)).blob();
    return new File([blob], file.name, { type: 'video/mp4' });
  } finally {
    signal?.removeEventListener('abort', stop);
    d.done(id);
  }
}
