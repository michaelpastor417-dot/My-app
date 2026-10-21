import { ASPECT_RATIOS, type AspectRatio } from '../store/editorStore';

/** Export resolutions, named by the frame's shorter side like CapCut. */
export const RESOLUTIONS = { '480p': 480, '720p': 720, '1080p': 1080, '2K': 1440, '4K': 2160 } as const;
export type Resolution = keyof typeof RESOLUTIONS;
export const FRAME_RATES = [24, 25, 30, 50, 60] as const;
export type QualityLevel = 'low' | 'recommended' | 'high';

/** Rough bits per pixel per frame for each quality, used for the size estimate. */
const BITS_PER_PIXEL: Record<QualityLevel, number> = { low: 0.04, recommended: 0.08, high: 0.16 };

/** Output dimensions for a canvas ratio at a resolution; always even, as video encoders require. */
export function exportSize(ratio: AspectRatio, resolution: Resolution): { width: number; height: number } {
  const [w, h] = ASPECT_RATIOS[ratio];
  const scale = RESOLUTIONS[resolution] / Math.min(w, h);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(w), height: even(h) };
}

/** Frames needed to cover `duration` seconds (the last frame may be partial). */
export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

/** Approximate file size in bytes: video at the quality's bit density plus 128 kbps audio. */
export function estimateBytes(width: number, height: number, fps: number, duration: number, quality: QualityLevel) {
  const videoBits = width * height * fps * BITS_PER_PIXEL[quality] * duration;
  const audioBits = 128_000 * duration;
  return (videoBits + audioBits) / 8;
}

export const CODEC_NAMES: Record<string, string> = {
  avc: 'H.264',
  vp9: 'VP9',
  av1: 'AV1',
  aac: 'AAC',
  opus: 'Opus',
};
