import type { CanvasBackground, Clip, ClipAudio, Crop, TextData, Timeline, Track, Transform } from '../types';
import { DEFAULT_TRANSFORM, NO_CROP, clampCrop } from '../engine/geometry';
import { clampAudio } from '../engine/audio';
import { transitionOverlap } from './transitions';
import { MAX_SPEED, MIN_SPEED, mediaTimeAt, setValuesAt, transformAt } from './animation';

/**
 * Pure timeline operations. Every function returns a new Timeline and never
 * mutates its input, which keeps undo/redo (a later step) trivial to add.
 */

export const DEFAULT_IMAGE_DURATION = 3;

export function createTimeline(): Timeline {
  return {
    tracks: [{ id: 'main', kind: 'video', isMain: true, muted: false, hidden: false, locked: false }],
    clips: [],
    background: { type: 'color', color: '#000000' },
  };
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function clipsOnTrack(timeline: Timeline, trackId: string): Clip[] {
  return timeline.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export function timelineDuration(timeline: Timeline): number {
  return timeline.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

export function getTrack(timeline: Timeline, trackId: string): Track | undefined {
  return timeline.tracks.find((t) => t.id === trackId);
}

/** Clips that should be playing at time `t`, in no particular order. */
export function clipsAt(timeline: Timeline, t: number): Clip[] {
  return timeline.clips.filter((c) => t >= c.start && t < clipEnd(c));
}

/**
 * Re-lay a magnetic track's clips back to back in the given order, starting
 * at 0. A clip with a transition overlaps the next one by the transition's length.
 */
function packClips(ordered: Clip[]): Clip[] {
  let cursor = 0;
  return ordered.map((c, i) => {
    const packed = { ...c, start: cursor };
    cursor += c.duration - transitionOverlap(c, ordered[i + 1]);
    return packed;
  });
}

function replaceTrackClips(timeline: Timeline, trackId: string, trackClips: Clip[]): Timeline {
  return {
    ...timeline,
    clips: [...timeline.clips.filter((c) => c.trackId !== trackId), ...trackClips],
  };
}

/** Index in a magnetic track's clip order where a clip dropped at time `t` belongs. */
function magneticInsertIndex(ordered: Clip[], t: number): number {
  const idx = ordered.findIndex((c) => t < c.start + c.duration / 2);
  return idx === -1 ? ordered.length : idx;
}

/**
 * Earliest start >= `desired` on an overlay track where a clip of `duration`
 * fits without overlapping any other clip on that track.
 */
export function findFreeStart(
  trackClips: Clip[],
  desired: number,
  duration: number,
  ignoreId?: string,
): number {
  const others = trackClips.filter((c) => c.id !== ignoreId).sort((a, b) => a.start - b.start);
  let start = Math.max(0, desired);
  for (const other of others) {
    if (start + duration <= other.start) break;
    if (start < clipEnd(other)) start = clipEnd(other);
  }
  return start;
}

/**
 * Add a track in its layer: text tracks go on top of everything, new video
 * tracks above other video but below text, and audio at the bottom.
 */
export function addTrack(timeline: Timeline, track: Track): Timeline {
  const { tracks } = timeline;
  if (track.kind === 'audio') return { ...timeline, tracks: [...tracks, track] };
  if (track.kind === 'text') return { ...timeline, tracks: [track, ...tracks] };
  const firstNonText = tracks.findIndex((t) => t.kind !== 'text');
  const at = firstNonText === -1 ? tracks.length : firstNonText;
  return { ...timeline, tracks: [...tracks.slice(0, at), track, ...tracks.slice(at)] };
}

/**
 * Place a clip on a track. On the main track the clip is inserted at the
 * nearest gap between existing clips (or appended when `at` is omitted);
 * on overlay tracks it lands at the first free spot at or after `at`.
 */
export function insertClip(timeline: Timeline, clip: Clip, at?: number): Timeline {
  const track = getTrack(timeline, clip.trackId);
  if (!track) throw new Error(`Unknown track ${clip.trackId}`);
  const existing = clipsOnTrack(timeline, track.id);

  if (track.isMain) {
    const idx = at === undefined ? existing.length : magneticInsertIndex(existing, at);
    const ordered = [...existing.slice(0, idx), clip, ...existing.slice(idx)];
    return replaceTrackClips(timeline, track.id, packClips(ordered));
  }

  const start = findFreeStart(existing, at ?? 0, clip.duration);
  return { ...timeline, clips: [...timeline.clips, { ...clip, start }] };
}

export function removeClip(timeline: Timeline, clipId: string): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;
  const without = { ...timeline, clips: timeline.clips.filter((c) => c.id !== clipId) };
  const track = getTrack(timeline, clip.trackId);
  if (track?.isMain) {
    return replaceTrackClips(without, track.id, packClips(clipsOnTrack(without, track.id)));
  }
  return without;
}

/**
 * Move a clip to `newStart` on `newTrackId`. Moving onto a track of the wrong
 * kind (e.g. audio onto a video track) is ignored.
 */
export function moveClip(
  timeline: Timeline,
  clipId: string,
  newStart: number,
  newTrackId: string,
): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  const target = getTrack(timeline, newTrackId);
  const source = clip && getTrack(timeline, clip.trackId);
  if (!clip || !target || !source || target.kind !== source.kind) return timeline;

  const removed = removeClip(timeline, clipId);
  return insertClip(removed, { ...clip, trackId: newTrackId }, newStart);
}

/** Remove overlay tracks that no longer hold any clips. The main track always stays. */
export function pruneEmptyTracks(timeline: Timeline): Timeline {
  const used = new Set(timeline.clips.map((c) => c.trackId));
  return { ...timeline, tracks: timeline.tracks.filter((t) => t.isMain || used.has(t.id)) };
}

/** Shortest a clip may become through trimming or splitting (one frame at 30fps). */
export const MIN_CLIP_DURATION = 1 / 30;

/**
 * Cut a clip in two at timeline time `t`. The right half gets `newId`.
 * Splitting too close to either edge is a no-op.
 */
export function splitClip(timeline: Timeline, clipId: string, t: number, newId: string): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip || t < clip.start + MIN_CLIP_DURATION || t > clipEnd(clip) - MIN_CLIP_DURATION) {
    return timeline;
  }
  const leftDuration = t - clip.start;
  const rightDuration = clip.duration - leftDuration;
  // A reversed clip shows the end of its source span first, so its left half covers the later source.
  const leftIn = clip.reversed ? clip.inPoint + rightDuration * clip.speed : clip.inPoint;
  const rightIn = clip.reversed ? clip.inPoint : clip.inPoint + leftDuration * clip.speed;
  // Fades belong to the clip's outer edges: the left half keeps the fade in, the right the fade out.
  // The transition belongs to the clip's end, so it moves to the right half.
  const left: Clip = {
    ...clip,
    transition: undefined,
    inPoint: leftIn,
    duration: leftDuration,
    audio: clampAudio({ ...clip.audio, fadeOut: 0 }, leftDuration),
  };
  const right: Clip = {
    ...clip,
    id: newId,
    start: t,
    inPoint: rightIn,
    duration: rightDuration,
    audio: clampAudio({ ...clip.audio, fadeIn: 0 }, rightDuration),
  };
  return { ...timeline, clips: [...timeline.clips.filter((c) => c.id !== clipId), left, right] };
}

/**
 * Drag one edge of a clip to timeline time `t`.
 *
 * `sourceDuration` is the length of the clip's media; pass Infinity for
 * images, text and freeze frames, which can be stretched freely. Speed and
 * reversal are respected: on a reversed clip the left edge is the end of the source. A clip can't be trimmed past its
 * source media, shorter than one frame, or (on overlay tracks) into a
 * neighbouring clip. On the main track the clip stays packed: trimming its
 * start shortens it from the left and everything after it ripples.
 */
export function trimClip(
  timeline: Timeline,
  clipId: string,
  edge: 'start' | 'end',
  t: number,
  sourceDuration: number,
): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  const track = clip && getTrack(timeline, clip.trackId);
  if (!clip || !track) return timeline;
  const siblings = clipsOnTrack(timeline, track.id).filter((c) => c.id !== clipId);
  const end = clipEnd(clip);
  // Timeline seconds of unused source before and after the covered span.
  const spanEnd = clip.inPoint + clip.duration * clip.speed;
  const roomBefore = Number.isFinite(sourceDuration) ? clip.inPoint / clip.speed : Infinity;
  const roomAfter = Number.isFinite(sourceDuration) ? (sourceDuration - spanEnd) / clip.speed : Infinity;
  let trimmed: Clip;

  if (edge === 'end') {
    let maxEnd = end + (clip.reversed ? roomBefore : roomAfter);
    if (!track.isMain) {
      const next = siblings.find((c) => c.start >= end);
      if (next) maxEnd = Math.min(maxEnd, next.start);
    }
    const newEnd = Math.min(Math.max(t, clip.start + MIN_CLIP_DURATION), maxEnd);
    const grow = newEnd - end;
    trimmed = {
      ...clip,
      duration: newEnd - clip.start,
      inPoint: clip.reversed ? clip.inPoint - grow * clip.speed : clip.inPoint,
    };
  } else {
    // How far the left edge moves; positive shortens the clip.
    let delta = t - clip.start;
    delta = Math.min(delta, clip.duration - MIN_CLIP_DURATION);
    delta = Math.max(delta, -(clip.reversed ? roomAfter : roomBefore));
    if (!track.isMain) {
      const prev = [...siblings].reverse().find((c) => clipEnd(c) <= clip.start);
      delta = Math.max(delta, (prev ? clipEnd(prev) : 0) - clip.start);
    }
    trimmed = {
      ...clip,
      start: track.isMain ? clip.start : clip.start + delta,
      // Images and text have no real source, but their in point still moves so keyframes stay put.
      inPoint: clip.reversed ? clip.inPoint : clip.inPoint + delta * clip.speed,
      duration: clip.duration - delta,
    };
  }

  trimmed.audio = clampAudio(trimmed.audio, trimmed.duration);
  const clips = timeline.clips.map((c) => (c.id === clipId ? trimmed : c));
  if (!track.isMain) return { ...timeline, clips };
  const next = { ...timeline, clips };
  return replaceTrackClips(next, track.id, packClips(clipsOnTrack(next, track.id)));
}

/** Insert a copy of a clip (with id `newId`) right after the original. */
export function duplicateClip(timeline: Timeline, clipId: string, newId: string): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;
  return insertClip(timeline, { ...clip, id: newId }, clipEnd(clip));
}

export function updateTrack(
  timeline: Timeline,
  trackId: string,
  patch: Partial<Pick<Track, 'muted' | 'hidden' | 'locked'>>,
): Timeline {
  return { ...timeline, tracks: timeline.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) };
}

export interface ClipPropsPatch {
  transform?: Partial<Transform>;
  crop?: Partial<Crop>;
  audio?: Partial<ClipAudio>;
}

/**
 * Change a clip's transform, crop and/or audio settings. Transform and volume
 * go through keyframes when the clip has any (edited or added at timeline time
 * `t`). Values are clamped: opacity 0..1, scale above 1%, crop leaves part of
 * the source, fades fit the clip.
 */
export function updateClipProps(timeline: Timeline, clipId: string, patch: ClipPropsPatch, t?: number): Timeline {
  return mapClip(timeline, clipId, (clip) => {
    const { volume, ...audio } = patch.audio ?? {};
    const animated =
      patch.transform || volume !== undefined
        ? setValuesAt(clip, t ?? clip.start, { transform: patch.transform, volume })
        : clip;
    return {
      ...animated,
      crop: clampCrop({ ...animated.crop, ...patch.crop }),
      audio: clampAudio({ ...animated.audio, ...audio }, animated.duration),
    };
  });
}

export function setBackground(timeline: Timeline, background: CanvasBackground): Timeline {
  return { ...timeline, background };
}

/** Change a text clip's content or styling. */
export function updateClipText(timeline: Timeline, clipId: string, patch: Partial<TextData>): Timeline {
  return {
    ...timeline,
    clips: timeline.clips.map((c) => (c.id === clipId && c.text ? { ...c, text: { ...c.text, ...patch } } : c)),
  };
}

/**
 * Move a video clip's sound onto its own clip on `audioTrack` (added to the
 * timeline), lined up with the video, which then plays silently.
 */
export function detachAudio(timeline: Timeline, clipId: string, newId: string, audioTrack: Track): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip || clip.text || clip.audioDetached || clip.audioOnly) return timeline;
  const audioClip: Clip = {
    ...clip,
    id: newId,
    trackId: audioTrack.id,
    transform: DEFAULT_TRANSFORM,
    crop: NO_CROP,
    audioOnly: true,
  };
  const withTrack = addTrack(timeline, audioTrack);
  const marked = {
    ...withTrack,
    clips: withTrack.clips.map((c) => (c.id === clipId ? { ...c, audioDetached: true } : c)),
  };
  return insertClip(marked, audioClip, clip.start);
}

export const FREEZE_DURATION = 3;

/**
 * Change a clip's speed, keeping the same source span (so its timeline length
 * changes). The main track ripples; on an overlay track, a clip that would now
 * overlap its neighbour moves to `spareTrack`, which is added for it.
 */
export function setClipSpeed(timeline: Timeline, clipId: string, speed: number, spareTrack: Track): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  const track = clip && getTrack(timeline, clip.trackId);
  if (!clip || !track) return timeline;
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  const duration = (clip.duration * clip.speed) / clamped;
  const updated: Clip = { ...clip, speed: clamped, duration, audio: clampAudio(clip.audio, duration) };
  const others = timeline.clips.filter((c) => c.id !== clipId);

  if (track.isMain) {
    const next = { ...timeline, clips: [...others, updated] };
    return replaceTrackClips(next, track.id, packClips(clipsOnTrack(next, track.id)));
  }
  const overlaps = others.some((c) => c.trackId === track.id && c.start < clipEnd(updated) && clipEnd(c) > updated.start);
  if (!overlaps) return { ...timeline, clips: [...others, updated] };
  const withTrack = addTrack({ ...timeline, clips: others }, { ...spareTrack, kind: track.kind });
  return { ...withTrack, clips: [...others, { ...updated, trackId: spareTrack.id }] };
}

export function setReversed(timeline: Timeline, clipId: string, reversed: boolean): Timeline {
  return {
    ...timeline,
    clips: timeline.clips.map((c) => (c.id === clipId ? { ...c, reversed: reversed || undefined } : c)),
  };
}

/**
 * Insert a FREEZE_DURATION still of the frame showing at `t`, splitting the
 * clip there; later clips on the track move right to make room.
 */
export function insertFreezeFrame(
  timeline: Timeline,
  clipId: string,
  t: number,
  ids: { right: string; freeze: string },
): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  const track = clip && getTrack(timeline, clip.trackId);
  if (!clip || !track || clip.text || clip.freezeAt !== undefined || t < clip.start || t > clipEnd(clip)) {
    return timeline;
  }
  const freeze: Clip = {
    ...clip,
    id: ids.freeze,
    start: t,
    inPoint: 0,
    speed: 1,
    duration: FREEZE_DURATION,
    reversed: undefined,
    keyframes: undefined,
    freezeAt: mediaTimeAt(clip, Math.min(t, clipEnd(clip) - MIN_CLIP_DURATION)),
    transform: transformAt(clip, t),
    audio: { volume: 0, fadeIn: 0, fadeOut: 0 },
  };
  const split = splitClip(timeline, clipId, t, ids.right);
  if (track.isMain) return insertClip(split, freeze, t);
  // Overlay: ripple this track's later clips right, then drop the still into the gap.
  const shifted = {
    ...split,
    clips: split.clips.map((c) =>
      c.trackId === track.id && c.start >= t - 1e-9 ? { ...c, start: c.start + FREEZE_DURATION } : c,
    ),
  };
  return { ...shifted, clips: [...shifted.clips, freeze] };
}

/** Apply a function to one clip. */
export function mapClip(timeline: Timeline, clipId: string, fn: (clip: Clip) => Clip): Timeline {
  return { ...timeline, clips: timeline.clips.map((c) => (c.id === clipId ? fn(c) : c)) };
}

/** Set or clear the transition from a main-track clip into the next one, re-packing the track. */
export function setTransition(timeline: Timeline, clipId: string, transition: Clip['transition'] | null): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  const track = clip && getTrack(timeline, clip.trackId);
  if (!clip || !track?.isMain) return timeline;
  const next = mapClip(timeline, clipId, (c) => ({ ...c, transition: transition ?? undefined }));
  return replaceTrackClips(next, track.id, packClips(clipsOnTrack(next, track.id)));
}

/**
 * Replace a clip with pieces covering only the given source ranges (e.g. the
 * parts with speech). Pieces keep every setting; the fade in stays on the
 * first piece, the fade out and transition on the last. The main track closes
 * the gaps; on other tracks the pieces sit back to back from the clip's start.
 * `newIds` supplies ids for the pieces after the first (which keeps the clip's id).
 */
export function keepSourceRanges(
  timeline: Timeline,
  clipId: string,
  ranges: [number, number][],
  newIds: () => string,
): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  const track = clip && getTrack(timeline, clip.trackId);
  if (!clip || !track || ranges.length === 0) return timeline;
  const spanEnd = clip.inPoint + clip.duration * clip.speed;
  const inside = ranges
    .map(([a, b]): [number, number] => [Math.max(a, clip.inPoint), Math.min(b, spanEnd)])
    .filter(([a, b]) => (b - a) / clip.speed >= MIN_CLIP_DURATION);
  // A reversed clip plays its source backwards, so its pieces run from the latest range down.
  if (clip.reversed) inside.reverse();
  if (inside.length === 0) return timeline;

  let cursor = clip.start;
  const pieces = inside.map(([a, b], i): Clip => {
    const duration = (b - a) / clip.speed;
    const first = i === 0;
    const last = i === inside.length - 1;
    const piece: Clip = {
      ...clip,
      id: first ? clip.id : newIds(),
      start: cursor,
      inPoint: a,
      duration,
      transition: last ? clip.transition : undefined,
      audio: clampAudio({ ...clip.audio, fadeIn: first ? clip.audio.fadeIn : 0, fadeOut: last ? clip.audio.fadeOut : 0 }, duration),
    };
    cursor += duration;
    return piece;
  });

  const others = timeline.clips.filter((c) => c.id !== clipId);
  const next = { ...timeline, clips: [...others, ...pieces] };
  if (!track.isMain) return next;
  // Keep the main track's order: the pieces take the original clip's place.
  const ordered = clipsOnTrack(timeline, track.id).flatMap((c) => (c.id === clipId ? pieces : [c]));
  return replaceTrackClips(next, track.id, packClips(ordered));
}
