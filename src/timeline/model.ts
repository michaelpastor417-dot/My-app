import type { Clip, Timeline, Track } from '../types';

/**
 * Pure timeline operations. Every function returns a new Timeline and never
 * mutates its input, which keeps undo/redo (a later step) trivial to add.
 */

export const DEFAULT_IMAGE_DURATION = 3;

export function createTimeline(): Timeline {
  return {
    tracks: [{ id: 'main', kind: 'video', isMain: true, muted: false, hidden: false }],
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
