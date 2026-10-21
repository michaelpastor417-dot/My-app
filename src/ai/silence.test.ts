import { describe, expect, it } from 'vitest';
import { speechRanges } from './silence';

/** A waveform at 10 peaks/s: 1 = speech, 0.001 = silence. */
const wave = (pattern: string) => [...pattern].map((c) => (c === '#' ? 1 : 0.001));
const opts = { thresholdDb: -30, minSilence: 0.5, padding: 0.1 };

describe('speechRanges', () => {
  it('keeps everything when there are no long pauses', () => {
    expect(speechRanges(wave('####..####'), 0, 1, opts, 10)).toEqual([[0, 1]]);
  });

  it('cuts long pauses, keeping a little padding around speech', () => {
    // speech 0-0.5, silence 0.5-1.5, speech 1.5-2
    const r = speechRanges(wave('#####..........#####'), 0, 2, opts, 10);
    expect(r.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)])).toEqual([[0, 0.6], [1.4, 2]]);
  });

  it('trims leading and trailing silence down to the padding', () => {
    // speech 0.6-1.0 -> kept 0.5-1.1 so the first and last words aren't clipped
    const r = speechRanges(wave('......####......'), 0, 1.6, opts, 10);
    expect(r.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)])).toEqual([[0.5, 1.1]]);
  });

  it('only looks at the requested span and threshold is relative to it', () => {
    const peaks = [...wave('##########'), ...Array(10).fill(0.02), ...wave('..........')];
    // Within 1..2s the quiet 0.02 signal is the loudest thing, so it's kept.
    expect(speechRanges(peaks, 1, 2, opts, 10)).toEqual([[1, 2]]);
  });

  it('returns nothing for a completely silent span', () => {
    expect(speechRanges(Array(20).fill(0), 0, 2, opts, 10)).toEqual([]);
  });
});

import type { Clip } from '../types';
import { DEFAULT_TRANSFORM, NO_CROP } from '../engine/geometry';
import { DEFAULT_AUDIO } from '../engine/audio';
import { clipsOnTrack, createTimeline, insertClip, keepSourceRanges } from '../timeline/model';

const clip = (id: string, patch: Partial<Clip> = {}): Clip => ({
  id,
  assetId: 'a',
  trackId: 'main',
  start: 0,
  inPoint: 0,
  speed: 1,
  duration: 10,
  transform: DEFAULT_TRANSFORM,
  crop: NO_CROP,
  audio: DEFAULT_AUDIO,
  ...patch,
});

describe('keepSourceRanges', () => {
  let n = 0;
  const ids = () => `p${++n}`;
  const layout = (t: ReturnType<typeof createTimeline>) =>
    clipsOnTrack(t, 'main').map((c) => [c.id, +c.start.toFixed(2), +c.inPoint.toFixed(2), +c.duration.toFixed(2)]);

  it('replaces a clip with its kept pieces and closes the gaps on the main track', () => {
    n = 0;
    let t = insertClip(createTimeline(), clip('a', { audio: { volume: 1, fadeIn: 1, fadeOut: 1 }, transition: { type: 'fade', duration: 0.5 } }));
    t = insertClip(t, clip('b', { duration: 2 }));
    t = keepSourceRanges(t, 'a', [[1, 3], [5, 9]], ids);
    // a covers 1-3, p1 covers 5-9 (with the transition into b overlapping 0.5s)
    expect(layout(t)).toEqual([['a', 0, 1, 2], ['p1', 2, 5, 4], ['b', 5.5, 0, 2]]);
    const [a, p1] = clipsOnTrack(t, 'main');
    expect([a.audio.fadeIn, a.audio.fadeOut, a.transition]).toEqual([1, 0, undefined]);
    expect([p1.audio.fadeIn, p1.audio.fadeOut, p1.transition?.type]).toEqual([0, 1, 'fade']);
  });

  it('respects speed and only uses the part of the source the clip covers', () => {
    n = 0;
    let t = insertClip(createTimeline(), clip('a', { inPoint: 2, speed: 2, duration: 3 })); // source 2-8
    t = keepSourceRanges(t, 'a', [[0, 4], [6, 20]], ids);
    expect(layout(t)).toEqual([['a', 0, 2, 1], ['p1', 1, 6, 1]]);
  });

  it('orders pieces of a reversed clip from the latest source first', () => {
    n = 0;
    let t = insertClip(createTimeline(), clip('a', { reversed: true }));
    t = keepSourceRanges(t, 'a', [[1, 2], [5, 7]], ids);
    expect(layout(t)).toEqual([['a', 0, 5, 2], ['p1', 2, 1, 1]]);
  });

  it('leaves the timeline alone when nothing would be kept', () => {
    const t = insertClip(createTimeline(), clip('a'));
    expect(keepSourceRanges(t, 'a', [], ids)).toBe(t);
    expect(keepSourceRanges(t, 'a', [[20, 30]], ids)).toBe(t);
  });
});
