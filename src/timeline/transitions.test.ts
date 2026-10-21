import { describe, expect, it } from 'vitest';
import type { Clip } from '../types';
import { DEFAULT_TRANSFORM, NO_CROP } from '../engine/geometry';
import { DEFAULT_AUDIO } from '../engine/audio';
import { clipsOnTrack, createTimeline, insertClip, removeClip, setTransition, splitClip } from './model';
import { transitionAt, transitionGain, transitionOverlap } from './transitions';

const clip = (id: string, duration: number): Clip => ({
  id,
  assetId: 'a',
  trackId: 'main',
  start: 0,
  inPoint: 0,
  speed: 1,
  duration,
  transform: DEFAULT_TRANSFORM,
  crop: NO_CROP,
  audio: DEFAULT_AUDIO,
});

const build = () => {
  let t = insertClip(createTimeline(), clip('a', 4));
  t = insertClip(t, clip('b', 4));
  t = insertClip(t, clip('c', 2));
  return setTransition(t, 'a', { type: 'fade', duration: 1 });
};
const starts = (t: ReturnType<typeof build>) => clipsOnTrack(t, 'main').map((c) => [c.id, c.start]);

describe('transition packing', () => {
  it('overlaps the next clip by the transition length', () => {
    expect(starts(build())).toEqual([['a', 0], ['b', 3], ['c', 7]]);
  });

  it('never overlaps by more than half of either clip', () => {
    expect(transitionOverlap({ duration: 4, transition: { type: 'fade', duration: 3 } }, { duration: 1 })).toBe(0.5);
    const t = setTransition(build(), 'b', { type: 'fade', duration: 3 }); // c is 2s -> 1s overlap
    expect(starts(t)).toEqual([['a', 0], ['b', 3], ['c', 6]]);
  });

  it('has no effect on the last clip, and clearing it closes the overlap', () => {
    expect(starts(setTransition(build(), 'c', { type: 'fade', duration: 1 }))).toEqual([['a', 0], ['b', 3], ['c', 7]]);
    expect(starts(setTransition(build(), 'a', null))).toEqual([['a', 0], ['b', 4], ['c', 8]]);
  });

  it('moves to the right half when the clip is split', () => {
    const t = splitClip(build(), 'a', 1, 'a2');
    expect(t.clips.find((c) => c.id === 'a')!.transition).toBeUndefined();
    expect(t.clips.find((c) => c.id === 'a2')!.transition).toEqual({ type: 'fade', duration: 1 });
  });

  it('re-packs when a clip is removed', () => {
    expect(starts(removeClip(build(), 'b'))).toEqual([['a', 0], ['c', 3]]);
  });
});

describe('transitionAt', () => {
  it('reports both clips and progress through the overlap', () => {
    const t = build();
    expect(transitionAt(t, 2.9)).toBeNull();
    const mid = transitionAt(t, 3.5)!;
    expect([mid.from.id, mid.to.id, mid.type, mid.progress]).toEqual(['a', 'b', 'fade', 0.5]);
    expect(transitionAt(t, 4)).toBeNull();
  });

  it('crossfades the two clips\' sound', () => {
    const t = build();
    const [a, b, c] = clipsOnTrack(t, 'main');
    expect(transitionGain(t, a, 3.25)).toBeCloseTo(0.75);
    expect(transitionGain(t, b, 3.25)).toBeCloseTo(0.25);
    expect(transitionGain(t, c, 3.25)).toBe(1);
    expect(transitionGain(t, b, 5)).toBe(1);
  });
});
