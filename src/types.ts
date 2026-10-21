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
}

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
}

export interface Timeline {
  /** Ordered top to bottom as drawn; visual stacking is the reverse (top track renders on top). */
  tracks: Track[];
  clips: Clip[];
}
