import type { Clip, Timeline, Track } from '../types';

/**
 * Pure timeline operations. Every function returns a new Timeline and never
 * mutates its input, which keeps undo/redo (a later step) trivial to add.
 */

export const DEFAULT_IMAGE_DURATION = 3;

export function createTimeline(): Timeline {
  return {
    tracks: [{ id: 'main', kind: 'video', isMain: true, muted: false, hidden: false, locked: false }],
    clips: [],
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

/** Re-lay a magnetic track's clips back to back in the given order, starting at 0. */
function packClips(ordered: Clip[]): Clip[] {
  let cursor = 0;
  return ordered.map((c) => {
    const packed = { ...c, start: cursor };
    cursor += c.duration;
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

export function addTrack(timeline: Timeline, track: Track): Timeline {
  // New overlay tracks go above existing ones, except audio which stacks below the main track.
  const tracks =
    track.kind === 'audio' ? [...timeline.tracks, track] : [track, ...timeline.tracks];
  return { ...timeline, tracks };
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
  const left: Clip = { ...clip, duration: leftDuration };
  const right: Clip = {
    ...clip,
    id: newId,
    start: t,
    inPoint: clip.inPoint + leftDuration,
    duration: clip.duration - leftDuration,
  };
  return { ...timeline, clips: [...timeline.clips.filter((c) => c.id !== clipId), left, right] };
}

/**
 * Drag one edge of a clip to timeline time `t`.
 *
 * `sourceDuration` is the length of the clip's media; pass Infinity for
 * images, which can be stretched freely. A clip can't be trimmed past its
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
  const bounded = Number.isFinite(sourceDuration);
  const siblings = clipsOnTrack(timeline, track.id).filter((c) => c.id !== clipId);
  const end = clipEnd(clip);
  let trimmed: Clip;

  if (edge === 'end') {
    let maxEnd = bounded ? clip.start + (sourceDuration - clip.inPoint) : Infinity;
    if (!track.isMain) {
      const next = siblings.find((c) => c.start >= end);
      if (next) maxEnd = Math.min(maxEnd, next.start);
    }
    const newEnd = Math.min(Math.max(t, clip.start + MIN_CLIP_DURATION), maxEnd);
    trimmed = { ...clip, duration: newEnd - clip.start };
  } else {
    // How far the left edge moves; positive shortens the clip.
    let delta = t - clip.start;
    delta = Math.min(delta, clip.duration - MIN_CLIP_DURATION);
    if (bounded) delta = Math.max(delta, -clip.inPoint);
    if (!track.isMain) {
      const prev = [...siblings].reverse().find((c) => clipEnd(c) <= clip.start);
      delta = Math.max(delta, (prev ? clipEnd(prev) : 0) - clip.start);
    }
    trimmed = {
      ...clip,
      start: track.isMain ? clip.start : clip.start + delta,
      inPoint: bounded ? clip.inPoint + delta : clip.inPoint,
      duration: clip.duration - delta,
    };
  }

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
