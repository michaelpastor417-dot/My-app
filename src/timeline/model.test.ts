import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import {
  addTrack,
  clipsAt,
  clipsOnTrack,
  createTimeline,
  findFreeStart,
  insertClip,
  moveClip,
  pruneEmptyTracks,
  removeClip,
  timelineDuration,
} from './model';

const clip = (id: string, duration: number, trackId = 'main', start = 0): Clip => ({
  id,
  assetId: 'a',
  trackId,
  start,
  inPoint: 0,
  duration,
});

const overlay: Track = { id: 'ov', kind: 'video', isMain: false, muted: false, hidden: false };
const audio: Track = { id: 'au', kind: 'audio', isMain: false, muted: false, hidden: false };

const starts = (clips: Clip[]) => clips.map((c) => [c.id, c.start]);

describe('main track (magnetic)', () => {
  it('appends clips back to back', () => {
    let t = createTimeline();
    t = insertClip(t, clip('a', 2));
    t = insertClip(t, clip('b', 3));
    t = insertClip(t, clip('c', 1));
    expect(starts(clipsOnTrack(t, 'main'))).toEqual([['a', 0], ['b', 2], ['c', 5]]);
    expect(timelineDuration(t)).toBe(6);
  });

  it('inserts between clips based on drop position', () => {
    let t = createTimeline();
    t = insertClip(t, clip('a', 2));
    t = insertClip(t, clip('b', 2));
    t = insertClip(t, clip('x', 1), 1.5); // past a's midpoint, before b's
    expect(starts(clipsOnTrack(t, 'main'))).toEqual([['a', 0], ['x', 2], ['b', 3]]);
  });

  it('closes the gap when a clip is removed', () => {
    let t = createTimeline();
    t = insertClip(t, clip('a', 2));
    t = insertClip(t, clip('b', 2));
    t = insertClip(t, clip('c', 2));
    t = removeClip(t, 'b');
    expect(starts(clipsOnTrack(t, 'main'))).toEqual([['a', 0], ['c', 2]]);
  });

  it('reorders when a clip is dragged', () => {
    let t = createTimeline();
    t = insertClip(t, clip('a', 2));
    t = insertClip(t, clip('b', 2));
    t = insertClip(t, clip('c', 2));
    t = moveClip(t, 'c', 0, 'main');
    expect(starts(clipsOnTrack(t, 'main'))).toEqual([['c', 0], ['a', 2], ['b', 4]]);
  });
});

describe('overlay tracks', () => {
  it('places clips freely but never overlapping', () => {
    let t = addTrack(createTimeline(), overlay);
    t = insertClip(t, clip('a', 2, 'ov'), 1);
    t = insertClip(t, clip('b', 2, 'ov'), 2); // would overlap a -> pushed to 3
    expect(starts(clipsOnTrack(t, 'ov'))).toEqual([['a', 1], ['b', 3]]);
  });

  it('findFreeStart fits a clip into a gap that is large enough', () => {
    const existing = [clip('a', 1, 'ov', 0), clip('b', 1, 'ov', 3)];
    expect(findFreeStart(existing, 0.5, 1)).toBe(1);
    expect(findFreeStart(existing, 0.5, 3)).toBe(4);
  });

  it('keeps clip position when removed from overlay', () => {
    let t = addTrack(createTimeline(), overlay);
    t = insertClip(t, clip('a', 2, 'ov'), 0);
    t = insertClip(t, clip('b', 2, 'ov'), 5);
    t = removeClip(t, 'a');
    expect(starts(clipsOnTrack(t, 'ov'))).toEqual([['b', 5]]);
  });
});

describe('moving across tracks', () => {
  it('refuses to move a video clip onto an audio track', () => {
    let t = addTrack(createTimeline(), audio);
    t = insertClip(t, clip('a', 2));
    expect(moveClip(t, 'a', 0, 'au')).toBe(t);
  });

  it('moves a clip from main to an overlay and repacks main', () => {
    let t = addTrack(createTimeline(), overlay);
    t = insertClip(t, clip('a', 2));
    t = insertClip(t, clip('b', 2));
    t = moveClip(t, 'a', 4, 'ov');
    expect(starts(clipsOnTrack(t, 'main'))).toEqual([['b', 0]]);
    expect(starts(clipsOnTrack(t, 'ov'))).toEqual([['a', 4]]);
  });
});

describe('queries', () => {
  it('clipsAt returns clips covering a time (end exclusive)', () => {
    let t = addTrack(createTimeline(), overlay);
    t = insertClip(t, clip('a', 2));
    t = insertClip(t, clip('o', 1, 'ov'), 1);
    expect(clipsAt(t, 1.5).map((c) => c.id).sort()).toEqual(['a', 'o']);
    expect(clipsAt(t, 2).map((c) => c.id)).toEqual([]);
  });

  it('pruneEmptyTracks keeps the main track', () => {
    const t = pruneEmptyTracks(addTrack(createTimeline(), overlay));
    expect(t.tracks.map((tr) => tr.id)).toEqual(['main']);
  });
});
