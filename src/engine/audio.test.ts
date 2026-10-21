import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO, clampAudio, clipGain, computePeaks, waveformBars } from './audio';
import { DEFAULT_TRANSFORM, NO_CROP } from './geometry';
import type { Clip } from '../types';

const clip = (audio = DEFAULT_AUDIO, extra: Partial<Clip> = {}): Clip => ({
  id: 'c',
  assetId: 'a',
  trackId: 't',
  start: 10,
  inPoint: 0,
  duration: 4,
  transform: DEFAULT_TRANSFORM,
  crop: NO_CROP,
  audio,
  ...extra,
});

describe('clipGain', () => {
  it('plays at the clip volume', () => {
    expect(clipGain(clip({ ...DEFAULT_AUDIO, volume: 1.5 }), 12)).toBe(1.5);
  });

  it('ramps up during the fade in and down during the fade out', () => {
    const c = clip({ volume: 1, fadeIn: 1, fadeOut: 2 });
    expect(clipGain(c, 10)).toBe(0);
    expect(clipGain(c, 10.5)).toBe(0.5);
    expect(clipGain(c, 11.5)).toBe(1);
    expect(clipGain(c, 13)).toBe(0.5);
    expect(clipGain(c, 14)).toBe(0);
  });

  it('is silent for a video whose audio was detached', () => {
    expect(clipGain(clip(DEFAULT_AUDIO, { audioDetached: true }), 12)).toBe(0);
  });
});

describe('clampAudio', () => {
  it('limits volume and keeps fades inside the clip', () => {
    expect(clampAudio({ volume: 5, fadeIn: 3, fadeOut: 3 }, 4)).toEqual({ volume: 2, fadeIn: 3, fadeOut: 1 });
    expect(clampAudio({ volume: -1, fadeIn: -1, fadeOut: 0 }, 4)).toEqual({ volume: 0, fadeIn: 0, fadeOut: 0 });
  });
});

describe('computePeaks', () => {
  it('takes the loudest sample per bucket across channels', () => {
    const left = new Float32Array([0.1, -0.5, 0.2, 0.0, 0.3, 0.1]);
    const right = new Float32Array([0.0, 0.0, 0.0, -0.9, 0.0, 0.0]);
    // 6 samples at 6Hz, 3 peaks per second -> buckets of 2 samples
    expect(computePeaks([left, right], 6, 3)).toEqual([0.5, 0.9, 0.3].map((v) => Math.fround(v)));
  });

  it('handles silence', () => {
    expect(computePeaks([], 44100)).toEqual([]);
  });
});

describe('waveformBars', () => {
  const peaks = [0.1, 0.2, 0.9, 0.4, 0.5, 0.6, 0.7, 0.8, 0.3, 0.2];
  it('maps a source time range onto a number of bars', () => {
    // 10 peaks per second; seconds 0.2..0.6 -> peaks[2..6) into 2 bars
    expect(waveformBars(peaks, 0.2, 0.6, 2, 10)).toEqual([0.9, 0.6]);
  });
  it('repeats peaks when bars outnumber them, and is silent past the end', () => {
    expect(waveformBars(peaks, 0.9, 1.1, 4, 10)).toEqual([0.2, 0.2, 0, 0]);
  });
});
