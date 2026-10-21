import { describe, expect, it } from 'vitest';
import { estimateBytes, exportSize, frameCount } from './settings';
import { timeStretch } from './timeStretch';

describe('export settings', () => {
  it('scales the canvas ratio to the chosen resolution, with even sizes', () => {
    expect(exportSize('16:9', '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(exportSize('16:9', '720p')).toEqual({ width: 1280, height: 720 });
    expect(exportSize('9:16', '4K')).toEqual({ width: 2160, height: 3840 });
    expect(exportSize('4:3', '480p')).toEqual({ width: 640, height: 480 });
  });

  it('counts frames, rounding a partial last frame up', () => {
    expect(frameCount(2, 30)).toBe(60);
    expect(frameCount(2.01, 30)).toBe(61);
    expect(frameCount(0, 30)).toBe(1);
  });

  it('estimates bigger files for higher quality', () => {
    const low = estimateBytes(1920, 1080, 30, 10, 'low');
    const high = estimateBytes(1920, 1080, 30, 10, 'high');
    expect(high).toBeGreaterThan(low * 3);
    expect(low / 1e6).toBeGreaterThan(2);
  });
});

/** Frequency of a signal estimated from upward zero crossings. */
function frequency(signal: Float32Array, sampleRate: number): number {
  let crossings = 0;
  for (let i = 1; i < signal.length; i++) if (signal[i - 1] < 0 && signal[i] >= 0) crossings++;
  return crossings / (signal.length / sampleRate);
}

describe('timeStretch', () => {
  const rate = 48000;
  const tone = new Float32Array(rate * 2).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5);

  it('changes length by the rate', () => {
    expect(timeStretch([tone], 2)[0].length).toBe(rate);
    expect(timeStretch([tone], 0.5)[0].length).toBe(rate * 4);
  });

  it('keeps the pitch when speeding up or slowing down', () => {
    for (const r of [0.5, 1.5, 2]) {
      const out = timeStretch([tone], r)[0];
      // Ignore the edges, where frames don't fully overlap.
      const middle = out.subarray(4096, out.length - 4096);
      expect(Math.abs(frequency(middle, rate) - 440)).toBeLessThan(10);
    }
  });

  it('keeps the level steady (no volume pumping)', () => {
    const out = timeStretch([tone], 1.5)[0];
    let peak = 0;
    for (let i = 4096; i < out.length - 4096; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeGreaterThan(0.4);
    expect(peak).toBeLessThan(0.6);
  });

  it('stretches every channel identically', () => {
    const [left, right] = timeStretch([tone, tone], 1.3);
    expect(Array.from(left.subarray(1000, 1010))).toEqual(Array.from(right.subarray(1000, 1010)));
  });
});

import type { Clip, MediaAsset } from '../types';
import { DEFAULT_TRANSFORM, NO_CROP } from '../engine/geometry';
import { DEFAULT_AUDIO } from '../engine/audio';
import { createTimeline, insertClip, setTransition, updateTrack } from '../timeline/model';
import { audibleClips, clipSamples, gainCurve } from './audioMix';

const clip = (id: string, patch: Partial<Clip> = {}): Clip => ({
  id,
  assetId: 'v',
  trackId: 'main',
  start: 0,
  inPoint: 0,
  speed: 1,
  duration: 2,
  transform: DEFAULT_TRANSFORM,
  crop: NO_CROP,
  audio: DEFAULT_AUDIO,
  ...patch,
});
const assets: MediaAsset[] = [
  { id: 'v', name: 'v', kind: 'video', url: '', duration: 10, peaks: [0.5] },
  { id: 'silent', name: 's', kind: 'video', url: '', duration: 10, peaks: [] },
];

describe('audioMix', () => {
  it('leaves out silent, detached, frozen and muted clips', () => {
    let t = insertClip(createTimeline(), clip('a'));
    t = insertClip(t, clip('b', { assetId: 'silent' }));
    t = insertClip(t, clip('c', { audioDetached: true }));
    t = insertClip(t, clip('d', { freezeAt: 1 }));
    expect(audibleClips(t, assets).map((c) => c.id)).toEqual(['a']);
    expect(audibleClips(updateTrack(t, 'main', { muted: true }), assets)).toEqual([]);
  });

  it('builds the gain curve from volume, fades and transitions', () => {
    let t = insertClip(createTimeline(), clip('a', { audio: { volume: 2, fadeIn: 1, fadeOut: 0 } }));
    t = insertClip(t, clip('b'));
    t = setTransition(t, 'a', { type: 'fade', duration: 1 }); // b starts at 1
    const a = t.clips.find((c) => c.id === 'a')!;
    const curve = gainCurve(t, a, 10); // 21 points over 2s
    expect(curve[0]).toBeCloseTo(0);
    expect(curve[5]).toBeCloseTo(1); // half way through the fade in: 2 * 0.5, transition starts at 1s
    expect(curve[15]).toBeCloseTo(1); // 1.5s: volume 2 x half way through the crossfade
    expect(curve[19]).toBeCloseTo(0.2); // 1.9s: volume 2 x 10% left of the crossfade
  });

  it('cuts, reverses and stretches the source span', () => {
    const source = [Float32Array.from({ length: 100 }, (_, i) => i)];
    const cut = clipSamples(source, 10, clip('a', { inPoint: 2, duration: 3 }))[0];
    expect([cut.length, cut[0], cut[29]]).toEqual([30, 20, 49]);
    const reversed = clipSamples(source, 10, clip('a', { inPoint: 2, duration: 3, reversed: true }))[0];
    expect([reversed[0], reversed[29]]).toEqual([49, 20]);
    const fast = clipSamples(source, 10, clip('a', { inPoint: 0, duration: 2, speed: 2 }))[0];
    expect(fast.length).toBe(20); // 4s of source played in 2s
  });
});
