// Twitch clip download for the desktop shell. The same logic as src/twitch/clip.ts (resolveClip, parseClipResponse), here because the
// main process can fetch Twitch without a page's CORS rules and the page cannot. If Twitch changes its wire format, change both.
const GQL = 'https://gql.twitch.tv/gql';
const CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
const HASH = '2db6a3b20eabf510bd3cf465ae2408834b59eb6b8af89ca73ab1486cacecfb63';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : d);

function parseClipResponse(slug, json) {
  const root = Array.isArray(json) ? json[0] : json;
  if (root?.errors?.length && !root?.data?.clip) throw new Error('Twitch refused the request. The clip link may be wrong, or Twitch has changed how clips are fetched.');
  const clip = root?.data?.clip;
  if (!clip) throw new Error('Twitch has no clip with that link. It may have been deleted, or it is private.');
  const token = clip.playbackAccessToken;
  if (!token?.signature || !token?.value) throw new Error('Twitch did not give a download link yet. A new clip can take a minute to finish processing: try again shortly.');
  const asset = Array.isArray(clip.assets) ? clip.assets[0] : undefined; // the second asset is the portrait version
  const qualities = Array.isArray(asset?.videoQualities) ? asset.videoQualities.filter((q) => typeof q?.sourceURL === 'string') : [];
  if (!qualities.length) throw new Error('Twitch lists no video file for that clip.');
  const ranked = [...qualities].sort((a, b) => num(b.quality) - num(a.quality) || num(b.frameRate) - num(a.frameRate));
  // every version, best first: the best can be HEVC, which a device may not decode, so the page asks for the next one down
  const sources = ranked.map((q) => {
    const u = new URL(q.sourceURL);
    u.searchParams.set('sig', token.signature);
    u.searchParams.set('token', token.value);
    return { url: u.toString(), height: Math.round(num(q.quality, 720)), fps: Math.round(num(q.frameRate, 30)) || 30 };
  });
  const best = sources[0];
  const height = best.height;
  const ratio = num(asset?.aspectRatio, 16 / 9) || 16 / 9;
  return {
    slug,
    title: typeof clip.title === 'string' && clip.title.trim() ? clip.title.trim() : slug,
    url: best.url,
    sources,
    width: Math.round(height * ratio),
    height,
    fps: best.fps,
    durationSec: num(clip.durationSeconds),
  };
}

function clipFileName(c) {
  const base = c.title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || c.slug}.mp4`;
}

async function resolveClip(slug, fetchImpl = fetch, signal) {
  const body = JSON.stringify([{ operationName: 'ShareClipRenderStatus', variables: { slug }, extensions: { persistedQuery: { version: 1, sha256Hash: HASH } } }]);
  let res;
  try {
    res = await fetchImpl(GQL, { method: 'POST', headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' }, body, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error('Could not reach Twitch. Check the internet connection.');
  }
  if (!res.ok) throw new Error(`Twitch answered ${res.status}.`);
  return parseClipResponse(slug, await res.json());
}

/** Resolve and download. Returns the file's bytes and what Twitch said about it. `onProgress(fraction | undefined)`. */
async function downloadClip(slug, { onProgress, signal, fetchImpl = fetch, rank = 0 } = {}) {
  const clip = await resolveClip(slug, fetchImpl, signal);
  let res;
  try {
    res = await fetchImpl((clip.sources[rank] ?? clip.sources[0]).url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error('Could not download the clip. Check the internet connection.');
  }
  if (!res.ok || !res.body) throw new Error(`Twitch answered ${res.status} for the video file.`);
  const total = num(res.headers.get('content-length'));
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(total ? Math.min(1, got / total) : undefined);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) (bytes.set(c, at), (at += c.length));
  return { clip, name: clipFileName(clip), bytes };
}

module.exports = { parseClipResponse, resolveClip, downloadClip, clipFileName };
