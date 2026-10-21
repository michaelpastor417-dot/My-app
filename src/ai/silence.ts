import { PEAKS_PER_SECOND } from '../engine/audio';

export interface SilenceOptions {
  /** How far below the loudest moment counts as silence, in dB (e.g. -30). */
  thresholdDb: number;
  /** Shortest pause worth removing, in seconds. */
  minSilence: number;
  /** Sound kept either side of each removed pause, in seconds, so words aren't clipped. */
  padding: number;
}

export const DEFAULT_SILENCE: SilenceOptions = { thresholdDb: -30, minSilence: 0.5, padding: 0.12 };

/**
 * Source-time ranges [start, end) within [from, to) worth keeping: everything
 * except pauses quieter than the threshold that last at least `minSilence`.
 * `peaks` is a waveform (loudest sample per 1/peaksPerSecond s).
 */
export function speechRanges(
  peaks: number[],
  from: number,
  to: number,
  options: SilenceOptions = DEFAULT_SILENCE,
  peaksPerSecond = PEAKS_PER_SECOND,
): [number, number][] {
  const first = Math.max(0, Math.floor(from * peaksPerSecond));
  const last = Math.min(peaks.length, Math.ceil(to * peaksPerSecond));
  let loudest = 0;
  for (let i = first; i < last; i++) loudest = Math.max(loudest, peaks[i]);
  if (loudest === 0) return [];
  const threshold = loudest * 10 ** (options.thresholdDb / 20);

  // Silent runs long enough to remove, as [start, end) source seconds.
  const pauses: [number, number][] = [];
  let runStart = -1;
  for (let i = first; i <= last; i++) {
    const quiet = i < last && peaks[i] < threshold;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      const start = runStart / peaksPerSecond;
      const end = i / peaksPerSecond;
      if (end - start >= options.minSilence) pauses.push([start, end]);
      runStart = -1;
    }
  }

  // Keep the gaps between pauses, widened by the padding.
  const keep: [number, number][] = [];
  let cursor = from;
  for (const [start, end] of pauses) {
    const cutFrom = start === first / peaksPerSecond ? from : start + options.padding;
    const cutTo = end >= to ? to : end - options.padding;
    if (cutTo - cutFrom <= 0) continue;
    if (cutFrom > cursor) keep.push([cursor, cutFrom]);
    cursor = cutTo;
  }
  if (cursor < to) keep.push([cursor, to]);
  return keep.filter(([a, b]) => b - a > 1e-6);
}
