import { Capacitor } from '@capacitor/core';

export type PlatformName = 'android' | 'electron' | 'web';

export const platform: PlatformName = Capacitor.isNativePlatform()
  ? 'android'
  : (globalThis as any).turbocut?.platform === 'electron'
    ? 'electron'
    : 'web';

/** Ask the user for files. A hidden <input> works in browsers, Electron and the Android WebView alike. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Keep the screen on during long work (export, playback). No-op where unsupported. */
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as any).wakeLock?.request('screen');
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}

/** Give the user a file. Browsers and Electron download it; Android writes it to cache and opens the share sheet. */
export async function saveFile(data: Blob | ArrayBuffer | string, name: string, mime: string): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  if (platform !== 'android') {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return;
  }
  // The Android WebView ignores <a download>, so go through the Filesystem and Share plugins.
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const CHUNK = 3 * 1024 * 1024; // multiple of 3, so every chunk but the last is base64 without padding
  for (let off = 0; off < Math.max(1, blob.size); off += CHUNK) {
    const bytes = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const args = { path: name, data: btoa(bin), directory: Directory.Cache };
    await (off === 0 ? Filesystem.writeFile(args) : Filesystem.appendFile(args)); // first chunk creates/truncates the file
  }
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
  await Share.share({ title: name, url: uri });
}
