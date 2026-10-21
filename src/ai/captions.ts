import type { Clip } from '../types';

/** A recognised stretch of speech, timed in seconds from the start of the audio it came from. */
export interface SpeechChunk {
  text: string;
  start: number;
  end: number;
}

/** Longest caption line, in characters, before it's split. */
export const MAX_CAPTION_CHARS = 42;

/**
 * Turn recognised chunks into caption lines short enough to read: chunks
 * longer than `maxChars` are split at word boundaries, sharing the chunk's
 * time between the parts by length. Empty chunks are dropped.
 */
export function captionLines(chunks: SpeechChunk[], maxChars = MAX_CAPTION_CHARS): SpeechChunk[] {
  const lines: SpeechChunk[] = [];
  for (const chunk of chunks) {
    const words = chunk.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || !(chunk.end > chunk.start)) continue;
    const parts: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxChars && current) {
        parts.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    parts.push(current);
    const total = parts.reduce((n, p) => n + p.length, 0);
    let t = chunk.start;
    for (const text of parts) {
      const share = ((chunk.end - chunk.start) * text.length) / total;
      lines.push({ text, start: t, end: t + share });
      t += share;
    }
  }
  return lines;
}

/**
 * Where caption lines fall on the timeline for a clip, given line times in the
 * clip's source media. Lines are trimmed to the part of the source the clip
 * plays (respecting trim and speed); lines outside it are left out.
 */
export function placeCaptions(clip: Clip, lines: SpeechChunk[]): SpeechChunk[] {
  const sourceEnd = clip.inPoint + clip.duration * clip.speed;
  const toTimeline = (s: number) => clip.start + (s - clip.inPoint) / clip.speed;
  return lines
    .map((l) => ({ text: l.text, start: Math.max(l.start, clip.inPoint), end: Math.min(l.end, sourceEnd) }))
    .filter((l) => l.end - l.start > 0.05)
    .map((l) => ({ text: l.text, start: toTimeline(l.start), end: toTimeline(l.end) }));
}
