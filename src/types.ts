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
  /**
   * Loudness envelope for waveforms: peak level (0 to 1) per 1/PEAKS_PER_SECOND
   * of a second. Filled in after import; absent while decoding, empty when the
   * file has no sound.
   */
  peaks?: number[];
  /** The file couldn't be found in storage when the project was opened. */
  missing?: boolean;
}

/** Text tracks hold text and sticker clips and always draw above video tracks. */
export type TrackKind = 'video' | 'audio' | 'text';

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

export type TextAnimationIn = 'none' | 'fade' | 'slide-up' | 'pop' | 'typewriter';
export type TextAnimationOut = 'none' | 'fade' | 'slide-down' | 'pop';

/** Content and styling of a text (or emoji sticker) clip. */
export interface TextData {
  content: string;
  fontFamily: string;
  /** Size in points; one point is 1/1080 of the canvas's shorter side, so text looks the same at any ratio. */
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  strokeColor: string;
  /** Outline thickness as a fraction of the font size; 0 for none. */
  strokeWidth: number;
  shadow: boolean;
  backgroundColor: string;
  /** 0 hides the background box. */
  backgroundOpacity: number;
  animationIn: TextAnimationIn;
  animationOut: TextAnimationOut;
}

export interface ClipAudio {
  /** 1 is the original level; up to 2 (200%). */
  volume: number;
  /** Seconds. */
  fadeIn: number;
  fadeOut: number;
}

/**
 * A snapshot of a clip's animatable values at one moment. `time` is clip-local
 * time (see clipLocalTime), so keyframes stay attached to the same moment of
 * the content when the clip is trimmed, split or sped up.
 */
export interface Keyframe {
  time: number;
  transform: Transform;
  volume: number;
}

/**
 * Colour adjustments. Each runs from -100 to 100 with 0 meaning "unchanged",
 * except sharpen and vignette which run from 0 to 100.
 */
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  sharpen: number;
  vignette: number;
}

export type FilterId =
  | 'vivid'
  | 'warm'
  | 'cool'
  | 'bw'
  | 'noir'
  | 'vintage'
  | 'film'
  | 'faded'
  | 'cinematic'
  | 'sunset';
export type EffectId = 'blur' | 'vignette' | 'glitch' | 'rgb-split' | 'pixelate' | 'grain' | 'mirror' | 'shake';
export type TransitionType =
  | 'fade'
  | 'fade-black'
  | 'fade-white'
  | 'slide-left'
  | 'slide-up'
  | 'wipe-left'
  | 'zoom'
  | 'circle'
  | 'blur';

/** What fills the canvas where the main-track media doesn't cover it. */
export type CanvasBackground = { type: 'color'; color: string } | { type: 'blur'; amount: number };

/** A placed piece of media on the timeline. All times are in seconds. */
export interface Clip {
  id: string;
  /** Media clips reference an imported asset; text clips have `text` instead. */
  assetId?: string;
  text?: TextData;
  trackId: string;
  /** Where the clip begins on the timeline. */
  start: number;
  /** Offset into the source media where playback begins. */
  inPoint: number;
  /** Playback speed; the clip covers `duration * speed` seconds of source. */
  speed: number;
  /** Plays the covered source span backwards. */
  reversed?: boolean;
  /** Shows this single source frame for the clip's whole duration (a freeze frame). */
  freezeAt?: number;
  /** Sorted by time. When present, transform and volume come from these instead of `transform`/`audio.volume`. */
  keyframes?: Keyframe[];
  /** Length of the clip on the timeline. */
  duration: number;
  /** Ignored for audio clips. */
  transform: Transform;
  /** Ignored for audio clips. */
  crop: Crop;
  /** Ignored for text clips. */
  audio: ClipAudio;
  /** A look preset; intensity 0 to 1. */
  filter?: { id: FilterId; intensity: number };
  /** Manual colour adjustments on top of the filter; missing keys are 0. */
  adjust?: Partial<Adjustments>;
  /** A video effect; intensity 0 to 1. */
  effect?: { id: EffectId; intensity: number };
  /**
   * Main track only: transition into the next clip. The next clip starts
   * `duration` seconds earlier so the two overlap while the transition plays.
   */
  transition?: { type: TransitionType; duration: number };
  /** A video clip whose sound was moved to its own audio clip; it plays silently. */
  audioDetached?: boolean;
  /** An audio clip that plays the sound of a video asset (made by detaching audio). */
  audioOnly?: boolean;
}

export interface Timeline {
  /** Ordered top to bottom as drawn; visual stacking is the reverse (top track renders on top). */
  tracks: Track[];
  clips: Clip[];
  background: CanvasBackground;
}
