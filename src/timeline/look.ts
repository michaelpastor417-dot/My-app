import type { Adjustments, Clip, EffectId, FilterId } from '../types';

type Rgb = [number, number, number];

export const NO_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  sharpen: 0,
  vignette: 0,
};

export const ADJUSTMENT_CONTROLS: { key: keyof Adjustments; label: string; min: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -100 },
  { key: 'contrast', label: 'Contrast', min: -100 },
  { key: 'saturation', label: 'Saturation', min: -100 },
  { key: 'exposure', label: 'Exposure', min: -100 },
  { key: 'temperature', label: 'Temp', min: -100 },
  { key: 'tint', label: 'Tint', min: -100 },
  { key: 'highlights', label: 'Highlights', min: -100 },
  { key: 'shadows', label: 'Shadows', min: -100 },
  { key: 'sharpen', label: 'Sharpen', min: 0 },
  { key: 'vignette', label: 'Vignette', min: 0 },
];

export interface FilterPreset {
  id: FilterId;
  label: string;
  adjust: Partial<Adjustments>;
  /** Colour pushed into the dark and bright parts of the image (split toning), 0..1 per channel offset. */
  splitTone?: { shadows: Rgb; highlights: Rgb };
}

export const FILTERS: FilterPreset[] = [
  { id: 'vivid', label: 'Vivid', adjust: { saturation: 40, contrast: 15, sharpen: 15 } },
  { id: 'warm', label: 'Warm', adjust: { temperature: 45, saturation: 10, highlights: -10 } },
  { id: 'cool', label: 'Cool', adjust: { temperature: -45, tint: -5, contrast: 5 } },
  { id: 'bw', label: 'B&W', adjust: { saturation: -100, contrast: 10 } },
  { id: 'noir', label: 'Noir', adjust: { saturation: -100, contrast: 55, shadows: -30, vignette: 50 } },
  {
    id: 'vintage',
    label: 'Vintage',
    adjust: { saturation: -30, contrast: -15, temperature: 25, vignette: 35 },
    splitTone: { shadows: [0.06, 0.02, -0.04], highlights: [0.06, 0.04, -0.02] },
  },
  { id: 'film', label: 'Film', adjust: { contrast: 20, saturation: -10, shadows: 15, highlights: -15, vignette: 20 } },
  { id: 'faded', label: 'Faded', adjust: { contrast: -40, saturation: -25, shadows: 35, brightness: 5 } },
  {
    id: 'cinematic',
    label: 'Cinematic',
    adjust: { contrast: 20, saturation: -10, vignette: 25 },
    splitTone: { shadows: [-0.06, 0.03, 0.08], highlights: [0.08, 0.03, -0.06] },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    adjust: { temperature: 55, tint: 15, saturation: 20, exposure: 5 },
    splitTone: { shadows: [0.05, -0.02, 0.04], highlights: [0.08, 0.02, -0.04] },
  },
];

export const EFFECTS: { id: EffectId; label: string; icon: string }[] = [
  { id: 'blur', label: 'Blur', icon: '◌' },
  { id: 'vignette', label: 'Vignette', icon: '◉' },
  { id: 'glitch', label: 'Glitch', icon: '▚' },
  { id: 'rgb-split', label: 'RGB split', icon: '◫' },
  { id: 'pixelate', label: 'Pixelate', icon: '▦' },
  { id: 'grain', label: 'Film grain', icon: '░' },
  { id: 'mirror', label: 'Mirror', icon: '⇋' },
  { id: 'shake', label: 'Shake', icon: '≋' },
];

/** Numeric ids for the shader; 0 is "no effect". */
export const EFFECT_CODES: Record<EffectId, number> = {
  blur: 1,
  vignette: 2,
  glitch: 3,
  'rgb-split': 4,
  pixelate: 5,
  grain: 6,
  mirror: 7,
  shake: 8,
};

/** Everything the GPU needs to colour-grade and apply effects to one clip. */
export interface ResolvedLook {
  /** Final adjustments, each scaled to -1..1 (sharpen and vignette 0..1). */
  adjust: Adjustments;
  splitShadows: Rgb;
  splitHighlights: Rgb;
  effect: number;
  effectIntensity: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Combine a clip's filter (scaled by its intensity) with its manual
 * adjustments and effect. Returns null when the clip needs no processing.
 */
export function resolveLook(clip: Pick<Clip, 'filter' | 'adjust' | 'effect'>): ResolvedLook | null {
  const preset = clip.filter && FILTERS.find((f) => f.id === clip.filter!.id);
  const strength = preset ? clip.filter!.intensity : 0;
  const adjust = { ...NO_ADJUSTMENTS };
  for (const key of Object.keys(adjust) as (keyof Adjustments)[]) {
    const lo = key === 'sharpen' || key === 'vignette' ? 0 : -100;
    const total = (clip.adjust?.[key] ?? 0) + (preset?.adjust[key] ?? 0) * strength;
    adjust[key] = clamp(total, lo, 100) / 100;
  }
  const scale = (c: Rgb | undefined): Rgb => (c ? [c[0] * strength, c[1] * strength, c[2] * strength] : [0, 0, 0]);
  const effect = clip.effect ? EFFECT_CODES[clip.effect.id] : 0;
  const look: ResolvedLook = {
    adjust,
    splitShadows: scale(preset?.splitTone?.shadows),
    splitHighlights: scale(preset?.splitTone?.highlights),
    effect,
    effectIntensity: clip.effect?.intensity ?? 0,
  };
  const graded = Object.values(adjust).some((v) => v !== 0) || [...look.splitShadows, ...look.splitHighlights].some((v) => v !== 0);
  return graded || (effect !== 0 && look.effectIntensity > 0) ? look : null;
}
