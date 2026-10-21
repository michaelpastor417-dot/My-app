import type { Clip, Keyframe, Transform } from '../types';
import { MAX_VOLUME } from '../engine/audio';

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;
/** Keyframes closer than this (in timeline seconds) to the playhead count as "at" it: half a frame. */
const KEYFRAME_TOLERANCE = 1 / 60;

/** How much source the clip covers, in source seconds. */
export function sourceSpan(clip: Clip): number {
  return clip.duration * clip.speed;
}

/**
 * Clip-local time at timeline time `t`: the source position being shown
 * (running backwards for reversed clips), or a virtual clock for images, text
 * and freeze frames. Keyframes are stored in this time base, so they stay on
 * the same frame of content through trims, splits and speed changes.
 */
export function clipLocalTime(clip: Clip, t: number): number {
  const elapsed = (t - clip.start) * clip.speed;
  return clip.reversed ? clip.inPoint + sourceSpan(clip) - elapsed : clip.inPoint + elapsed;
}

/** Inverse of clipLocalTime. */
export function timelineTimeOf(clip: Clip, localTime: number): number {
  const elapsed = clip.reversed ? clip.inPoint + sourceSpan(clip) - localTime : localTime - clip.inPoint;
  return clip.start + elapsed / clip.speed;
}

/** Which source frame (seconds) a media clip shows at timeline time `t`. */
export function mediaTimeAt(clip: Clip, t: number): number {
  return clip.freezeAt ?? clipLocalTime(clip, t);
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function lerpKeyframes(a: Keyframe, b: Keyframe, time: number): Omit<Keyframe, 'time'> {
  const p = b.time === a.time ? 0 : (time - a.time) / (b.time - a.time);
  const t = Object.fromEntries(
    (Object.keys(a.transform) as (keyof Transform)[]).map((k) => [k, lerp(a.transform[k], b.transform[k], p)]),
  ) as unknown as Transform;
  return { transform: t, volume: lerp(a.volume, b.volume, p) };
}

/** Animated values at clip-local time: interpolated between keyframes, held before the first and after the last. */
export function valuesAtLocal(clip: Clip, localTime: number): Omit<Keyframe, 'time'> {
  const kfs = clip.keyframes;
  if (!kfs?.length) return { transform: clip.transform, volume: clip.audio.volume };
  // Keyframes are sorted by local time; reversed clips simply walk them backwards.
  if (localTime <= kfs[0].time) return kfs[0];
  const last = kfs[kfs.length - 1];
  if (localTime >= last.time) return last;
  const i = kfs.findIndex((k) => k.time > localTime);
  return lerpKeyframes(kfs[i - 1], kfs[i], localTime);
}

export function transformAt(clip: Clip, t: number): Transform {
  return valuesAtLocal(clip, clipLocalTime(clip, t)).transform;
}

export function volumeAt(clip: Clip, t: number): number {
  return valuesAtLocal(clip, clipLocalTime(clip, t)).volume;
}

/** Index of the keyframe at timeline time `t` (within half a frame), or -1. */
export function keyframeIndexAt(clip: Clip, t: number): number {
  const local = clipLocalTime(clip, t);
  return clip.keyframes?.findIndex((k) => Math.abs(k.time - local) <= KEYFRAME_TOLERANCE * clip.speed) ?? -1;
}

function clampValues(v: Omit<Keyframe, 'time'>): Omit<Keyframe, 'time'> {
  return {
    transform: {
      ...v.transform,
      scale: Math.max(0.01, v.transform.scale),
      opacity: Math.min(1, Math.max(0, v.transform.opacity)),
    },
    volume: Math.min(MAX_VOLUME, Math.max(0, v.volume)),
  };
}

function withKeyframes(clip: Clip, keyframes: Keyframe[]): Clip {
  return { ...clip, keyframes: [...keyframes].sort((a, b) => a.time - b.time) };
}

/**
 * Change transform/volume at timeline time `t`. Without keyframes this edits
 * the clip's static values; with keyframes it updates the keyframe at `t`, or
 * adds one there (CapCut's behaviour), so the change only affects that moment.
 */
export function setValuesAt(clip: Clip, t: number, patch: { transform?: Partial<Transform>; volume?: number }): Clip {
  const current = valuesAtLocal(clip, clipLocalTime(clip, t));
  const next = clampValues({
    transform: { ...current.transform, ...patch.transform },
    volume: patch.volume ?? current.volume,
  });
  if (!clip.keyframes?.length) {
    return { ...clip, transform: next.transform, audio: { ...clip.audio, volume: next.volume } };
  }
  const i = keyframeIndexAt(clip, t);
  const keyframes = [...clip.keyframes];
  if (i >= 0) keyframes[i] = { ...keyframes[i], ...next };
  else keyframes.push({ time: clipLocalTime(clip, t), ...next });
  return withKeyframes(clip, keyframes);
}

/** Add a keyframe at `t` capturing the current values, or remove the one already there. */
export function toggleKeyframe(clip: Clip, t: number): Clip {
  const i = keyframeIndexAt(clip, t);
  if (i >= 0) {
    const keyframes = clip.keyframes!.filter((_, j) => j !== i);
    if (keyframes.length > 0) return { ...clip, keyframes };
    // Removing the last keyframe keeps its values as the clip's static values, so nothing jumps.
    const { transform, volume } = clip.keyframes![i];
    return { ...clip, keyframes: undefined, transform, audio: { ...clip.audio, volume } };
  }
  const values = valuesAtLocal(clip, clipLocalTime(clip, t));
  return withKeyframes(clip, [...(clip.keyframes ?? []), { time: clipLocalTime(clip, t), ...values }]);
}

/** Timeline times of the clip's keyframes that fall within it. */
export function keyframeTimes(clip: Clip): number[] {
  const end = clip.start + clip.duration;
  return (clip.keyframes ?? [])
    .map((k) => timelineTimeOf(clip, k.time))
    .filter((t) => t >= clip.start - 1e-9 && t <= end + 1e-9);
}
