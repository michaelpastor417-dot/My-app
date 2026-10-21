import { describe, expect, it } from 'vitest';
import type { Clip } from '../types';
import { DEFAULT_TRANSFORM, NO_CROP } from '../engine/geometry';
import { DEFAULT_AUDIO } from '../engine/audio';
import {
  clipLocalTime,
  keyframeIndexAt,
  keyframeTimes,
  mediaTimeAt,
  setValuesAt,
  toggleKeyframe,
  transformAt,
  volumeAt,
} from './animation';

const base: Clip = {
  id: 'c',
  assetId: 'a',
  trackId: 't',
  start: 10,
  inPoint: 2,
  speed: 1,
  duration: 4,
  transform: DEFAULT_TRANSFORM,
  crop: NO_CROP,
  audio: DEFAULT_AUDIO,
};

describe('clip time', () => {
  it('maps timeline time to source time with speed', () => {
    const fast = { ...base, speed: 2 };
    expect(clipLocalTime(fast, 11)).toBe(4);
    expect(mediaTimeAt(fast, 11)).toBe(4);
  });

  it('plays the covered span backwards when reversed', () => {
    const rev = { ...base, reversed: true, speed: 2 }; // covers source 2..10
    expect(mediaTimeAt(rev, 10)).toBe(10);
    expect(mediaTimeAt(rev, 13)).toBe(4);
  });

  it('holds one frame for freeze frames', () => {
    expect(mediaTimeAt({ ...base, freezeAt: 7.5 }, 12)).toBe(7.5);
  });
});

describe('keyframes', () => {
  // Keyframes at t=10 (x=0) and t=12 (x=0.4, volume 0)
  let clip = toggleKeyframe(base, 10);
  clip = setValuesAt(clip, 12, { transform: { x: 0.4 }, volume: 0 });

  it('without keyframes, edits change the static values', () => {
    const edited = setValuesAt(base, 11, { transform: { scale: 2 } });
    expect(edited.transform.scale).toBe(2);
    expect(edited.keyframes).toBeUndefined();
  });

  it('with keyframes, an edit away from a keyframe adds one', () => {
    expect(clip.keyframes!.map((k) => k.time)).toEqual([2, 4]);
  });

  it('interpolates between keyframes and holds outside them', () => {
    expect(transformAt(clip, 11).x).toBeCloseTo(0.2);
    expect(volumeAt(clip, 11)).toBeCloseTo(0.5);
    expect(transformAt(clip, 13.5).x).toBeCloseTo(0.4);
  });

  it('an edit on a keyframe updates it instead of adding another', () => {
    const edited = setValuesAt(clip, 12 + 1 / 120, { transform: { x: 0.8 } });
    expect(edited.keyframes).toHaveLength(2);
    expect(transformAt(edited, 12).x).toBeCloseTo(0.8);
  });

  it('removing the last keyframe keeps its values', () => {
    let one = toggleKeyframe(base, 11);
    one = setValuesAt(one, 11, { transform: { rotation: 45 } });
    const removed = toggleKeyframe(one, 11);
    expect(removed.keyframes).toBeUndefined();
    expect(removed.transform.rotation).toBe(45);
  });

  it('stays on the same frames when the clip is reversed', () => {
    const rev = { ...clip, reversed: true }; // shows source 6 at t=10 down to 2 at t=14
    expect(keyframeTimes(rev).sort((a, b) => a - b)).toEqual([12, 14]);
    expect(transformAt(rev, 13).x).toBeCloseTo(0.2);
  });

  it('stays attached to the content when the clip is sped up', () => {
    const fast = { ...clip, speed: 2, duration: 2 };
    // Keyframe at local time 4 now happens at 10 + (4 - 2) / 2 = 11
    expect(keyframeTimes(fast)).toEqual([10, 11]);
    expect(keyframeIndexAt(fast, 11)).toBe(1);
  });

  it('clamps animated values', () => {
    const edited = setValuesAt(clip, 12, { transform: { opacity: 5 }, volume: 9 });
    expect(edited.keyframes![1]).toMatchObject({ volume: 2, transform: { opacity: 1 } });
  });
});
