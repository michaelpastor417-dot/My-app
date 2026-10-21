import type { Clip, MediaAsset, Timeline } from '../types';
import { clipsAt, timelineDuration } from '../timeline/model';
import { clipGain } from './audio';
import { mediaTimeAt, volumeAt } from '../timeline/animation';
import { transitionGain } from '../timeline/transitions';
import { Compositor, type MediaEl } from './Compositor';
import { useEditor } from '../store/editorStore';

/** Max drift (seconds) between a playing media element and the master clock before we re-seek it. */
const PLAYING_DRIFT_TOLERANCE = 0.15;
/** Paused frames must be exact-ish so scrubbing shows the right frame. */
const PAUSED_DRIFT_TOLERANCE = 1 / 60;
/** How far ahead (seconds) to start seeking an upcoming clip's media to its in point. */
const PRE_ROLL = 1;
/** Time constant (seconds) for volume changes, so per-frame updates don't click. */
const GAIN_SMOOTHING = 0.015;

/**
 * Drives preview playback. The engine owns a wall-clock master clock that
 * advances `currentTime` in the store while playing; every clip's media
 * element is slaved to that clock, and each animation frame the visible clips
 * are composited onto the preview canvas (main track at the bottom, higher
 * overlay tracks on top).
 */
export class PlaybackEngine {
  private compositor: Compositor;
  /** One media element per clip, so the same asset can appear in two places at once. */
  private elements = new Map<string, MediaEl>();
  /**
   * Every clip's sound is routed element -> GainNode -> speakers, so volume can
   * go above 100% and fades are smooth. Created lazily with the first media clip.
   */
  private audioCtx: AudioContext | null = null;
  private gains = new Map<string, GainNode>();
  private rafId = 0;
  /** Only the first failing frame is logged, not one error per frame. */
  private reportedError = false;
  private lastTick = 0;
  private unsubscribe: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.compositor = new Compositor(canvas, (clipId) => this.elements.get(clipId));
    this.unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.isPlaying !== prev.isPlaying) {
        this.lastTick = performance.now();
        // Browsers keep audio suspended until a user gesture; pressing play is one.
        if (s.isPlaying) void this.audioCtx?.resume();
      }
      if (s.timeline !== prev.timeline || s.assets !== prev.assets) this.syncElementPool();
    });
    this.syncElementPool();
    this.rafId = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.unsubscribe();
    for (const clipId of this.elements.keys()) this.disposeClip(clipId);
    void this.audioCtx?.close();
  }

  private frame = (now: number) => {
    const state = useEditor.getState();
    if (state.isPlaying) {
      const duration = timelineDuration(state.timeline);
      const next = state.currentTime + (now - this.lastTick) / 1000;
      if (next >= duration) {
        useEditor.setState({ currentTime: duration, isPlaying: false });
      } else {
        useEditor.setState({ currentTime: next });
      }
    }
    this.lastTick = now;

    // Schedule the next frame first, so a problem drawing this one can never freeze the player.
    this.rafId = requestAnimationFrame(this.frame);
    const { timeline, assets, currentTime, isPlaying } = useEditor.getState();
    const active = clipsAt(timeline, currentTime);
    try {
      this.syncMedia(timeline, active, currentTime, isPlaying);
      this.draw(timeline, assets, active, currentTime);
    } catch (error) {
      if (!this.reportedError) console.error('Preview frame failed:', error);
      this.reportedError = true;
    }
  };

  /** Create elements for new clips and dispose of ones for deleted clips. */
  private syncElementPool() {
    const { timeline, assets } = useEditor.getState();
    const live = new Set(timeline.clips.map((c) => c.id));
    for (const clipId of [...this.elements.keys()]) {
      if (!live.has(clipId)) this.disposeClip(clipId);
    }
    for (const clip of timeline.clips) {
      if (!clip.assetId || this.elements.has(clip.id)) continue;
      const asset = assets.find((a) => a.id === clip.assetId);
      if (asset && !asset.missing) this.elements.set(clip.id, this.createElement(clip, asset));
    }
  }

  private createElement(clip: Clip, asset: MediaAsset): MediaEl {
    if (asset.kind === 'image') {
      const img = new Image();
      img.src = asset.url;
      return img;
    }
    // Detached audio only needs the sound, so skip decoding the video frames.
    const el = document.createElement(asset.kind === 'video' && !clip.audioOnly ? 'video' : 'audio');
    el.preload = 'auto';
    el.src = asset.url;
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    this.connectAudio(clip.id, el);
    return el;
  }

  private connectAudio(clipId: string, el: HTMLMediaElement) {
    this.audioCtx ??= new AudioContext();
    const gain = this.audioCtx.createGain();
    gain.gain.value = 0;
    this.audioCtx.createMediaElementSource(el).connect(gain).connect(this.audioCtx.destination);
    this.gains.set(clipId, gain);
  }

  private disposeClip(clipId: string) {
    const el = this.elements.get(clipId);
    if (el instanceof HTMLMediaElement) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.gains.get(clipId)?.disconnect();
    this.gains.delete(clipId);
    this.elements.delete(clipId);
  }

  private syncMedia(timeline: Timeline, active: Clip[], t: number, playing: boolean) {
    const activeIds = new Set(active.map((c) => c.id));
    for (const clip of timeline.clips) {
      const el = this.elements.get(clip.id);
      if (!(el instanceof HTMLMediaElement)) continue;

      if (!activeIds.has(clip.id)) {
        if (!el.paused) el.pause();
        // Pre-seek clips that are about to start so cuts don't flash black while they seek.
        const lead = clip.start - t;
        const first = mediaTimeAt(clip, clip.start);
        if (lead > 0 && lead < PRE_ROLL && !el.seeking && Math.abs(el.currentTime - first) > PAUSED_DRIFT_TOLERANCE) {
          el.currentTime = first;
        }
        continue;
      }

      const track = timeline.tracks.find((tr) => tr.id === clip.trackId);
      // Browsers can't play media backwards, so reversed clips step frame by frame and stay silent in preview.
      const stepped = clip.reversed || clip.freezeAt !== undefined;
      const gain = this.gains.get(clip.id);
      if (gain && this.audioCtx) {
        const level =
          track?.muted || stepped ? 0 : clipGain(clip, t, volumeAt(clip, t)) * transitionGain(timeline, clip, t);
        gain.gain.setTargetAtTime(level, this.audioCtx.currentTime, GAIN_SMOOTHING);
      }
      const target = mediaTimeAt(clip, t);
      const drift = Math.abs(el.currentTime - target);

      if (playing && !stepped) {
        if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
        // A sped-up clip drifts further between frames, so allow proportionally more.
        if (drift > PLAYING_DRIFT_TOLERANCE * Math.max(1, clip.speed)) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (drift > PAUSED_DRIFT_TOLERANCE && !el.seeking) el.currentTime = target;
      }
    }
  }

  private draw(timeline: Timeline, assets: MediaAsset[], active: Clip[], t: number) {
    this.compositor.draw(timeline, assets, active, t);
  }
}
