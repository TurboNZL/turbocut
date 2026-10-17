// Time is measured in integer frames of the project frame rate, never seconds,
// so cuts land exactly on frames and nothing drifts over a 20 minute edit.

export type Frame = number;

export type Easing = 'linear' | 'in' | 'out' | 'inOut' | 'hold' | 'bounce';

export interface Keyframe {
  /** Frame relative to the start of the clip on the timeline. */
  t: Frame;
  v: number;
  /** Easing used on the way from this keyframe to the next one. */
  ease: Easing;
}

/** Properties that can be animated. Each one is optional on a clip. */
export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

export const ANIM_DEFAULTS: Record<AnimProp, number> = {
  x: 0, // pixels from centre
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  volume: 1,
};

/** Kinds the renderer implements today. Box and zoom blur need a shader pass and are not built yet. */
export type BlurKind = 'gaussian' | 'pixelate';

export interface BlurEffect {
  type: 'blur';
  kind: BlurKind;
  /** Radius in pixels at project resolution. Static value; use `radiusKeys` to animate. */
  radius: number;
  radiusKeys?: Keyframe[];
}

export type Effect = BlurEffect;

/**
 * A text layer: a clip with no media that draws styled text. The style has the same shape as a caption style
 * (font, size, colours, outline, alignment, margins) so the same editor and renderer serve both.
 */
export interface TextSpec {
  content: string;
  style: import('../captions/ass.ts').AssStyle;
  animation: import('../captions/presets.ts').EntranceAnimation;
}

export interface Clip {
  id: string;
  /** Asset id for media clips; empty for a text layer. */
  assetId: string;
  /** Set on text layers, which draw text instead of a video frame. */
  text?: TextSpec;
  /** Position on the timeline. */
  start: Frame;
  /** Length on the timeline. */
  duration: Frame;
  /** Frame in the source media where this clip begins. */
  sourceIn: Frame;
  /** 1 = normal speed. Timeline duration = source length / speed. */
  speed: number;
  keys: Partial<Record<AnimProp, Keyframe[]>>;
  /** Static value used when a property has no keyframes. */
  base: Partial<Record<AnimProp, number>>;
  effects: Effect[];
  audioFadeIn: Frame;
  audioFadeOut: Frame;
  muted: boolean;
  /** Clips sharing a link id (a video and its own audio) are split, moved-by-delete and removed together. */
  link?: string;
}

export type TrackKind = 'video' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  clips: Clip[];
  locked: boolean;
  /** Video tracks: not drawn. */
  hidden: boolean;
  /** Audio tracks: not heard. */
  muted?: boolean;
}

export interface Asset {
  id: string;
  name: string;
  /** Opaque handle the platform layer can resolve (file path, blob URL, OPFS name). */
  ref: string;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Size of the media file in bytes, so a saved project can find the right file again. */
  size?: number;
  duration: Frame;
  width: number;
  height: number;
  /** The bin folder it sits in (a folder id), if any. */
  folder?: string;
}

/** A folder in the media bin. Folders only organise the bin; clips on the timeline do not know about them. */
export interface BinFolder {
  id: string;
  name: string;
}

export interface Project {
  version: 1;
  name: string;
  fps: number;
  width: number;
  height: number;
  assets: Record<string, Asset>;
  /** Media bin folders (absent in older projects). */
  folders?: BinFolder[];
  /** Lowest index is drawn first (bottom). */
  tracks: Track[];
  /** Caption clips live in their own list so they can be edited as text. */
  captions: CaptionCue[];
  captionPreset: string | null;
}

export interface CaptionWord {
  text: string;
  start: Frame;
  end: Frame;
}

export interface CaptionCue {
  id: string;
  start: Frame;
  end: Frame;
  text: string;
  /** Name of a style variant inside the active preset, e.g. "Default - Red". */
  style: string;
  words?: CaptionWord[];
}
