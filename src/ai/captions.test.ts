import { describe, expect, it } from 'vitest';
import type { Clip } from '../types';
import { DEFAULT_TRANSFORM, NO_CROP } from '../engine/geometry';
import { DEFAULT_AUDIO } from '../engine/audio';
import { captionLines, placeCaptions } from './captions';

describe('captionLines', () => {
  it('keeps short chunks as they are, trimmed', () => {
    expect(captionLines([{ text: '  Hello there. ', start: 1, end: 2 }])).toEqual([{ text: 'Hello there.', start: 1, end: 2 }]);
  });

  it('splits long chunks at word boundaries, sharing time by length', () => {
    const lines = captionLines([{ text: 'aaaa bbbb cccc dddd', start: 0, end: 8 }], 9);
    expect(lines.map((l) => l.text)).toEqual(['aaaa bbbb', 'cccc dddd']);
    expect(lines.map((l) => [l.start, l.end])).toEqual([[0, 4], [4, 8]]);
  });

  it('never splits inside a word, even a very long one', () => {
    expect(captionLines([{ text: 'supercalifragilistic ok', start: 0, end: 2 }], 5).map((l) => l.text)).toEqual([
      'supercalifragilistic',
      'ok',
    ]);
  });

  it('drops empty or zero-length chunks', () => {
    expect(captionLines([{ text: ' ', start: 0, end: 1 }, { text: 'x', start: 2, end: 2 }])).toEqual([]);
  });
});

describe('placeCaptions', () => {
  const clip: Clip = {
    id: 'c',
    assetId: 'a',
    trackId: 'main',
    start: 10,
    inPoint: 4, // the clip plays source 4..8 at 2x
    speed: 2,
    duration: 2,
    transform: DEFAULT_TRANSFORM,
    crop: NO_CROP,
    audio: DEFAULT_AUDIO,
  };

  it('maps source times onto the timeline through trim and speed', () => {
    expect(placeCaptions(clip, [{ text: 'hi', start: 5, end: 7 }])).toEqual([{ text: 'hi', start: 10.5, end: 11.5 }]);
  });

  it('cuts lines to the part the clip plays and drops the rest', () => {
    const placed = placeCaptions(clip, [
      { text: 'before', start: 0, end: 3 },
      { text: 'edge', start: 3, end: 5 },
      { text: 'after', start: 9, end: 10 },
    ]);
    expect(placed).toEqual([{ text: 'edge', start: 10, end: 10.5 }]);
  });
});

import { friendlyError } from './transcribe';

describe('friendlyError', () => {
  it('explains download failures and memory errors in plain words', () => {
    expect(friendlyError('Failed to fetch')).toMatch(/couldn't be downloaded/);
    expect(friendlyError('Could not locate file: status code 404')).toMatch(/couldn't be downloaded/);
    expect(friendlyError('Aborted(). Out of memory')).toMatch(/ran out of memory/);
    expect(friendlyError('Something else')).toBe('Something else');
  });
});
