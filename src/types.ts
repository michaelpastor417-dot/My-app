export type MediaKind = 'video' | 'image' | 'audio';

/** A file the user imported into the project's media library. */
export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  /** Object URL for the original file. */
  url: string;
  /** Source duration in seconds. Images have no intrinsic duration. */
  duration: number;
  width?: number;
  height?: number;
  /** Small data-URL preview for the media panel. */
  thumbnail?: string;
}

export type TrackKind = 'video' | 'audio';

/**
 * A track is a horizontal lane on the timeline.
 * The main track is "magnetic" like CapCut's: its clips always sit back to back
 * with no gaps. Every other track is an overlay where clips can sit anywhere.
 */
export interface Track {
  id: string;
  kind: TrackKind;
  isMain: boolean;
  muted: boolean;
  hidden: boolean;
  /** Locked tracks can't be edited: no selecting, moving, trimming, splitting or dropping. */
  locked: boolean;
}

/**
 * Where a visual clip sits on the canvas.
 * Position is the offset of the clip's centre from the canvas centre, as a
 * fraction of canvas width/height, so it survives aspect-ratio changes.
 * Scale 1 means "fit inside the canvas", like CapCut's default.
 */
export interface Transform {
  x: number;
  y: number;
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0 (invisible) to 1 (opaque). */
  opacity: number;
}

/** Fraction (0 to 1) of the source trimmed away from each side. */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What fills the canvas where the main-track media doesn't cover it. */
export type CanvasBackground = { type: 'color'; color: string } | { type: 'blur'; amount: number };

/** A placed piece of media on the timeline. All times are in seconds. */
export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  /** Where the clip begins on the timeline. */
  start: number;
  /** Offset into the source media where playback begins. */
  inPoint: number;
  /** Length of the clip on the timeline. */
  duration: number;
  /** Ignored for audio clips. */
  transform: Transform;
  /** Ignored for audio clips. */
  crop: Crop;
}

export interface Timeline {
  /** Ordered top to bottom as drawn; visual stacking is the reverse (top track renders on top). */
  tracks: Track[];
  clips: Clip[];
  background: CanvasBackground;
}
