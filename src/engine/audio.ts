import type { Clip, ClipAudio } from '../types';

export const DEFAULT_AUDIO: ClipAudio = { volume: 1, fadeIn: 0, fadeOut: 0 };
export const MAX_VOLUME = 2;
/** Resolution of stored waveforms. */
export const PEAKS_PER_SECOND = 100;

/** Keep volume in range and fades within the clip (together never longer than it). */
export function clampAudio(audio: ClipAudio, duration: number): ClipAudio {
  const volume = Math.min(MAX_VOLUME, Math.max(0, audio.volume));
  const fadeIn = Math.min(Math.max(0, audio.fadeIn), duration);
  const fadeOut = Math.min(Math.max(0, audio.fadeOut), duration - fadeIn);
  return { volume, fadeIn, fadeOut };
}

/** Gain (0 to MAX_VOLUME) a clip's sound should play at, at timeline time `t`. */
export function clipGain(clip: Clip, t: number): number {
  if (clip.audioDetached) return 0;
  const { volume, fadeIn, fadeOut } = clip.audio;
  const sinceStart = t - clip.start;
  const untilEnd = clip.start + clip.duration - t;
  let gain = volume;
  if (fadeIn > 0 && sinceStart < fadeIn) gain *= Math.max(0, sinceStart / fadeIn);
  if (fadeOut > 0 && untilEnd < fadeOut) gain *= Math.max(0, untilEnd / fadeOut);
  return gain;
}

/** Reduce decoded audio to one peak level (max |sample| across channels) per bucket. */
export function computePeaks(channels: Float32Array[], sampleRate: number, peaksPerSecond = PEAKS_PER_SECOND): number[] {
  if (channels.length === 0) return [];
  const bucket = Math.max(1, Math.round(sampleRate / peaksPerSecond));
  const length = channels[0].length;
  const peaks: number[] = [];
  for (let start = 0; start < length; start += bucket) {
    const end = Math.min(length, start + bucket);
    let max = 0;
    for (const data of channels) {
      for (let i = start; i < end; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
    }
    peaks.push(Math.min(1, max));
  }
  return peaks;
}

/**
 * Resample the source span [from, to) seconds of a waveform into `bars`
 * levels, taking the loudest peak in each bar's slice.
 */
export function waveformBars(
  peaks: number[],
  from: number,
  to: number,
  bars: number,
  peaksPerSecond = PEAKS_PER_SECOND,
): number[] {
  const out: number[] = [];
  const span = (to - from) * peaksPerSecond;
  for (let b = 0; b < bars; b++) {
    const i0 = Math.floor(from * peaksPerSecond + (span * b) / bars);
    const i1 = Math.max(i0 + 1, Math.floor(from * peaksPerSecond + (span * (b + 1)) / bars));
    let max = 0;
    for (let i = Math.max(0, i0); i < Math.min(peaks.length, i1); i++) max = Math.max(max, peaks[i]);
    out.push(max);
  }
  return out;
}
