import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { DEFAULT_TRANSFORM, NO_CROP } from '../engine/geometry';
import { DEFAULT_AUDIO } from '../engine/audio';
import {
  MIN_CLIP_DURATION,
  addTrack,
  clipsAt,
  clipsOnTrack,
  createTimeline,
  detachAudio,
  duplicateClip,
  findFreeStart,
  insertClip,
  moveClip,
  pruneEmptyTracks,
  removeClip,
  splitClip,
  timelineDuration,
  trimClip,
  updateTrack,
} from './model';

const clip = (id: string, duration: number, trackId = 'main', start = 0): Clip => ({
  id,
  assetId: 'a',
  trackId,
  start,
  inPoint: 0,
  duration,
  transform: DEFAULT_TRANSFORM,
  crop: NO_CROP,
  audio: DEFAULT_AUDIO,
});

const overlay: Track = { id: 'ov', kind: 'video', isMain: false, muted: false, hidden: false, locked: false };
const audio: Track = { id: 'au', kind: 'audio', isMain: false, muted: false, hidden: false, locked: false };

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

describe('splitClip', () => {
  it('cuts a clip into two halves with matching source offsets', () => {
    let t = insertClip(createTimeline(), { ...clip('a', 4), inPoint: 1 });
    t = splitClip(t, 'a', 1.5, 'b');
    const [a, b] = clipsOnTrack(t, 'main');
    expect(a).toMatchObject({ id: 'a', start: 0, inPoint: 1, duration: 1.5 });
    expect(b).toMatchObject({ id: 'b', start: 1.5, inPoint: 2.5, duration: 2.5 });
  });

  it('ignores a split at the very edge of a clip', () => {
    const t = insertClip(createTimeline(), clip('a', 4));
    expect(splitClip(t, 'a', 0, 'b')).toBe(t);
    expect(splitClip(t, 'a', 4, 'b')).toBe(t);
  });
});

describe('trimClip', () => {
  it('trims the end of a main clip and ripples later clips', () => {
    let t = insertClip(createTimeline(), clip('a', 4));
    t = insertClip(t, clip('b', 2));
    t = trimClip(t, 'a', 'end', 3, 10);
    expect(starts(clipsOnTrack(t, 'main'))).toEqual([['a', 0], ['b', 3]]);
  });

  it('cannot extend past the end of the source media', () => {
    let t = insertClip(createTimeline(), { ...clip('a', 4), inPoint: 1 });
    t = trimClip(t, 'a', 'end', 10, 6);
    expect(clipsOnTrack(t, 'main')[0].duration).toBe(5);
  });

  it('trimming the start of a main clip keeps it packed and advances the in point', () => {
    let t = insertClip(createTimeline(), clip('a', 2));
    t = insertClip(t, clip('b', 4));
    t = trimClip(t, 'b', 'start', 3, 10); // drag b's left edge 1s right
    const b = clipsOnTrack(t, 'main')[1];
    expect(b).toMatchObject({ start: 2, inPoint: 1, duration: 3 });
  });

  it('cannot extend the start before the beginning of the source', () => {
    let t = insertClip(createTimeline(), { ...clip('a', 2), inPoint: 0.5 });
    t = trimClip(t, 'a', 'start', -5, 10);
    expect(clipsOnTrack(t, 'main')[0]).toMatchObject({ inPoint: 0, duration: 2.5 });
  });

  it('stops overlay trims at neighbouring clips', () => {
    let t = addTrack(createTimeline(), overlay);
    t = insertClip(t, clip('a', 1, 'ov'), 0);
    t = insertClip(t, { ...clip('b', 1, 'ov'), inPoint: 5 }, 3);
    t = insertClip(t, clip('c', 1, 'ov'), 6);
    t = trimClip(t, 'b', 'start', 0, 10);
    t = trimClip(t, 'b', 'end', 99, 10);
    expect(clipsOnTrack(t, 'ov')[1]).toMatchObject({ start: 1, inPoint: 3, duration: 5 });
  });

  it('never makes a clip shorter than one frame', () => {
    let t = insertClip(createTimeline(), clip('a', 2));
    t = trimClip(t, 'a', 'end', -1, 10);
    expect(clipsOnTrack(t, 'main')[0].duration).toBeCloseTo(MIN_CLIP_DURATION);
  });

  it('lets images stretch freely', () => {
    let t = insertClip(createTimeline(), clip('img', 3));
    t = trimClip(t, 'img', 'end', 20, Infinity);
    t = trimClip(t, 'img', 'start', -4, Infinity);
    expect(clipsOnTrack(t, 'main')[0]).toMatchObject({ start: 0, inPoint: 0, duration: 24 });
  });
});

describe('duplicateClip', () => {
  it('inserts the copy right after the original on the main track', () => {
    let t = insertClip(createTimeline(), clip('a', 2));
    t = insertClip(t, clip('b', 2));
    t = duplicateClip(t, 'a', 'a2');
    expect(starts(clipsOnTrack(t, 'main'))).toEqual([['a', 0], ['a2', 2], ['b', 4]]);
  });

  it('places an overlay copy in the next free spot', () => {
    let t = addTrack(createTimeline(), overlay);
    t = insertClip(t, clip('a', 2, 'ov'), 1);
    t = insertClip(t, clip('b', 1, 'ov'), 3.5);
    t = duplicateClip(t, 'a', 'a2');
    expect(starts(clipsOnTrack(t, 'ov'))).toEqual([['a', 1], ['b', 3.5], ['a2', 4.5]]);
  });
});

describe('updateTrack', () => {
  it('toggles track flags', () => {
    const t = updateTrack(createTimeline(), 'main', { locked: true, muted: true });
    expect(t.tracks[0]).toMatchObject({ locked: true, muted: true, hidden: false });
  });
});

describe('track layering', () => {
  const text: Track = { id: 'tx', kind: 'text', isMain: false, muted: false, hidden: false, locked: false };
  it('keeps text on top, new video below text, audio at the bottom', () => {
    let t = addTrack(createTimeline(), text);
    t = addTrack(t, overlay);
    t = addTrack(t, audio);
    expect(t.tracks.map((tr) => tr.id)).toEqual(['tx', 'ov', 'main', 'au']);
  });

  it('refuses to move a text clip onto a video track', () => {
    let t = addTrack(addTrack(createTimeline(), text), overlay);
    t = insertClip(t, clip('words', 2, 'tx'), 0);
    expect(moveClip(t, 'words', 0, 'ov')).toBe(t);
  });
});

describe('audio', () => {
  it('splitting keeps the fade in on the left half and the fade out on the right', () => {
    let t = insertClip(createTimeline(), { ...clip('a', 4), audio: { volume: 1, fadeIn: 1, fadeOut: 1 } });
    t = splitClip(t, 'a', 2, 'b');
    const [a, b] = clipsOnTrack(t, 'main');
    expect(a.audio).toEqual({ volume: 1, fadeIn: 1, fadeOut: 0 });
    expect(b.audio).toEqual({ volume: 1, fadeIn: 0, fadeOut: 1 });
  });

  it('trimming shortens fades that no longer fit', () => {
    let t = insertClip(createTimeline(), { ...clip('a', 4), audio: { volume: 1, fadeIn: 3, fadeOut: 0 } });
    t = trimClip(t, 'a', 'end', 2, 10);
    expect(clipsOnTrack(t, 'main')[0].audio.fadeIn).toBe(2);
  });

  it('detaches a video clip\'s sound onto a lined-up audio clip', () => {
    let t = insertClip(createTimeline(), clip('a', 2));
    t = insertClip(t, { ...clip('v', 3), inPoint: 1 });
    t = detachAudio(t, 'v', 'v-audio', audio);
    expect(clipsOnTrack(t, 'main')[1]).toMatchObject({ id: 'v', audioDetached: true });
    expect(clipsOnTrack(t, 'au')[0]).toMatchObject({ id: 'v-audio', start: 2, inPoint: 1, duration: 3, audioOnly: true });
    // Detaching twice does nothing.
    expect(detachAudio(t, 'v', 'again', { ...audio, id: 'au2' })).toBe(t);
  });
});
