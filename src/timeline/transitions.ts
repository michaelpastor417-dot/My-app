import type { Clip, Timeline, TransitionType } from '../types';

export const TRANSITIONS: { type: TransitionType; label: string; icon: string }[] = [
  { type: 'fade', label: 'Dissolve', icon: '◐' },
  { type: 'fade-black', label: 'Dip to black', icon: '●' },
  { type: 'fade-white', label: 'Dip to white', icon: '○' },
  { type: 'slide-left', label: 'Slide left', icon: '⇠' },
  { type: 'slide-up', label: 'Slide up', icon: '⇡' },
  { type: 'wipe-left', label: 'Wipe', icon: '▧' },
  { type: 'zoom', label: 'Zoom in', icon: '⊕' },
  { type: 'circle', label: 'Circle', icon: '◯' },
  { type: 'blur', label: 'Blur', icon: '◌' },
];

/** Numeric ids for the shader. */
export const TRANSITION_CODES: Record<TransitionType, number> = {
  fade: 0,
  'fade-black': 1,
  'fade-white': 2,
  'slide-left': 3,
  'slide-up': 4,
  'wipe-left': 5,
  zoom: 6,
  circle: 7,
  blur: 8,
};

export const DEFAULT_TRANSITION_DURATION = 0.5;
export const MAX_TRANSITION_DURATION = 3;

/**
 * How long `a` and the clip after it actually overlap: the transition's
 * duration, limited to half of either clip so a transition never swallows a clip.
 */
export function transitionOverlap(a: Pick<Clip, 'transition' | 'duration'>, b: Pick<Clip, 'duration'> | undefined): number {
  if (!a.transition || !b) return 0;
  return Math.max(0, Math.min(a.transition.duration, a.duration / 2, b.duration / 2));
}

export interface ActiveTransition {
  from: Clip;
  to: Clip;
  type: TransitionType;
  /** 0 at the start of the overlap, 1 at its end. */
  progress: number;
}

/** The main-track transition playing at time `t`, if any. */
export function transitionAt(timeline: Timeline, t: number): ActiveTransition | null {
  const main = timeline.tracks.find((tr) => tr.isMain);
  if (!main) return null;
  const clips = timeline.clips.filter((c) => c.trackId === main.id).sort((a, b) => a.start - b.start);
  for (let i = 0; i < clips.length - 1; i++) {
    const from = clips[i];
    const to = clips[i + 1];
    const overlap = transitionOverlap(from, to);
    if (overlap > 0 && t >= to.start && t < to.start + overlap) {
      return { from, to, type: from.transition!.type, progress: (t - to.start) / overlap };
    }
  }
  return null;
}

/** Volume multiplier for a clip's sound so the two clips in a transition crossfade. */
export function transitionGain(timeline: Timeline, clip: Clip, t: number): number {
  const active = transitionAt(timeline, t);
  if (!active) return 1;
  if (active.from.id === clip.id) return 1 - active.progress;
  if (active.to.id === clip.id) return active.progress;
  return 1;
}
