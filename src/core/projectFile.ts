import type { Asset, Clip, Project } from './types.ts';

/**
 * A project as a file (`.turbocut`, JSON). It holds the edit, not the media: each asset keeps its file name and size,
 * and opening the project asks for the media again (`matchMedia` pairs them up by name, then size). Time is integer
 * frames, so a project file is exact and does not depend on the device that saved it.
 */
export const PROJECT_FORMAT = 'turbocut.project';
export const PROJECT_EXT = '.turbocut';

export function serializeProject(p: Project): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: 1, savedWith: 'TurboCut', project: p }, null, 1);
}

export const projectFileName = (name: string): string => `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || 'TurboCut project'}${PROJECT_EXT}`;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => fin(v) && Number.isInteger(v);

/** Throws an Error with a plain sentence when the text is not a usable project; otherwise returns it, with the parts the editor relies on checked. */
export function parseProject(json: string): Project {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isObj(data) || data.format !== PROJECT_FORMAT) throw new Error('That is not a TurboCut project file.');
  if (data.version !== 1) throw new Error('This project was saved by a newer TurboCut. Update the app to open it.');
  const p = data.project;
  if (!isObj(p) || !isObj(p.assets) || !Array.isArray(p.tracks) || !Array.isArray(p.captions)) throw new Error('The project file is damaged.');
  if (!int(p.fps) || p.fps < 1 || p.fps > 240) throw new Error('The project has no valid frame rate.');
  if (!int(p.width) || !int(p.height) || p.width < 16 || p.height < 16 || p.width > 8192 || p.height > 8192) throw new Error('The project has no valid size.');
  for (const [id, a] of Object.entries<any>(p.assets)) {
    if (!isObj(a) || a.id !== id || typeof a.name !== 'string' || !int(a.duration)) throw new Error('The project file is damaged (a media entry is wrong).');
  }
  // Bin folders are optional; an asset that names a folder that does not exist goes back to the top level.
  const folders = Array.isArray(p.folders) ? (p.folders as unknown[]).filter((f): f is { id: string; name: string } => isObj(f) && typeof f.id === 'string' && typeof f.name === 'string').slice(0, 200) : [];
  const folderIds = new Set(folders.map((f) => f.id));
  for (const a of Object.values<any>(p.assets)) if (a.folder !== undefined && !folderIds.has(a.folder)) delete a.folder;
  p.folders = folders;
  const clipIds = new Set<string>();
  for (const t of p.tracks) {
    if (!isObj(t) || typeof t.id !== 'string' || (t.kind !== 'video' && t.kind !== 'audio') || !Array.isArray(t.clips)) throw new Error('The project file is damaged (a track is wrong).');
    for (const c of t.clips as Clip[]) {
      if (!isObj(c) || typeof c.id !== 'string' || clipIds.has(c.id) || typeof c.assetId !== 'string' || !int(c.start) || !int(c.duration) || c.duration < 1 || !int(c.sourceIn) || !fin(c.speed) || c.speed <= 0 || !isObj(c.keys) || !isObj(c.base) || !Array.isArray(c.effects)) {
        throw new Error('The project file is damaged (a clip is wrong).');
      }
      if (!c.text && !p.assets[c.assetId]) throw new Error('The project file is damaged (a clip uses media that is not listed).');
      clipIds.add(c.id);
    }
  }
  if (!p.tracks.some((t: any) => t.kind === 'video') || !p.tracks.some((t: any) => t.kind === 'audio')) throw new Error('The project needs a video and an audio track.');
  return { ...p, name: typeof p.name === 'string' && p.name.trim() ? p.name : 'Untitled', captionPreset: typeof p.captionPreset === 'string' ? p.captionPreset : null } as Project;
}

export interface FileInfo {
  name: string;
  size: number;
}

/**
 * Pair the media a project needs with files the person picked: same name first, and when both sizes are known they must
 * agree (two different files can share a name). Each file is used once. Returns asset id -> index into `files`.
 */
export function matchMedia(assets: Pick<Asset, 'id' | 'name' | 'size'>[], files: FileInfo[]): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  const pick = (a: Pick<Asset, 'name' | 'size'>, strictSize: boolean) =>
    files.findIndex((f, i) => !used.has(i) && f.name === a.name && (!strictSize || a.size === undefined || f.size === a.size));
  for (const strict of [true, false]) {
    for (const a of assets) {
      if (out.has(a.id)) continue;
      const i = pick(a, strict);
      if (i >= 0) {
        out.set(a.id, i);
        used.add(i);
      }
    }
  }
  return out;
}
