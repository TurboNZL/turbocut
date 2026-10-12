/**
 * Twitch clip import.
 *
 * Browsers cannot fetch Twitch clip media directly (CORS), so resolving a clip to an MP4 URL runs in a
 * "resolver" that lives outside the web page: the Electron main process, the Android native layer, or a
 * small LAN host. The editor only needs this interface plus slug parsing.
 *
 * Twitch has no public API that returns clip media URLs, so any resolver depends on Twitch's unofficial
 * web endpoints and can break when they change. Keep all of that inside one resolver implementation.
 */

export interface ResolvedClip {
  slug: string;
  title: string;
  /** Direct URL to the highest quality MP4. */
  url: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
}

export interface ClipResolver {
  resolve(slug: string, signal?: AbortSignal): Promise<ResolvedClip>;
}

const SLUG = /^[A-Za-z0-9_-]{4,}$/;

/** Accepts clips.twitch.tv/<slug>, twitch.tv/<channel>/clip/<slug>, m.twitch.tv/..., or a bare slug. */
export function parseClipSlug(input: string): string | null {
  const text = input.trim();
  if (SLUG.test(text) && !text.includes('.')) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  let slug: string | undefined;
  if (host === 'clips.twitch.tv') slug = parts[0] === 'embed' ? (url.searchParams.get('clip') ?? undefined) : parts[0];
  else if (host === 'twitch.tv') {
    const i = parts.indexOf('clip');
    if (i >= 0) slug = parts[i + 1];
  }
  return slug && SLUG.test(slug) ? slug : null;
}
