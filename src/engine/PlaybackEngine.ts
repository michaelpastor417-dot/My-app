import type { Clip, MediaAsset, Timeline } from '../types';
import { clipsAt, timelineDuration } from '../timeline/model';
import { clipRect, cropRect } from './geometry';
import { useEditor } from '../store/editorStore';

/** Max drift (seconds) between a playing media element and the master clock before we re-seek it. */
const PLAYING_DRIFT_TOLERANCE = 0.15;
/** Paused frames must be exact-ish so scrubbing shows the right frame. */
const PAUSED_DRIFT_TOLERANCE = 1 / 60;
/** How far ahead (seconds) to start seeking an upcoming clip's media to its in point. */
const PRE_ROLL = 1;
/** Blur radius at background blur amount 1, as a fraction of the canvas's longer side. */
const BLUR_RADIUS_FRACTION = 0.06;

type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

/**
 * Drives preview playback. The engine owns a wall-clock master clock that
 * advances `currentTime` in the store while playing; every clip's media
 * element is slaved to that clock, and each animation frame the visible clips
 * are composited onto the preview canvas (main track at the bottom, higher
 * overlay tracks on top).
 */
export class PlaybackEngine {
  private ctx: CanvasRenderingContext2D;
  /** One media element per clip, so the same asset can appear in two places at once. */
  private elements = new Map<string, MediaEl>();
  private rafId = 0;
  private lastTick = 0;
  private unsubscribe: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.isPlaying !== prev.isPlaying) this.lastTick = performance.now();
      if (s.timeline !== prev.timeline || s.assets !== prev.assets) this.syncElementPool();
    });
    this.syncElementPool();
    this.rafId = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.unsubscribe();
    for (const el of this.elements.values()) this.disposeElement(el);
    this.elements.clear();
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

    const { timeline, assets, currentTime, isPlaying } = useEditor.getState();
    const active = clipsAt(timeline, currentTime);
    this.syncMedia(timeline, active, currentTime, isPlaying);
    this.draw(timeline, assets, active);
    this.rafId = requestAnimationFrame(this.frame);
  };

  /** Create elements for new clips and dispose of ones for deleted clips. */
  private syncElementPool() {
    const { timeline, assets } = useEditor.getState();
    const live = new Set(timeline.clips.map((c) => c.id));
    for (const [clipId, el] of this.elements) {
      if (!live.has(clipId)) {
        this.disposeElement(el);
        this.elements.delete(clipId);
      }
    }
    for (const clip of timeline.clips) {
      if (this.elements.has(clip.id)) continue;
      const asset = assets.find((a) => a.id === clip.assetId);
      if (asset) this.elements.set(clip.id, this.createElement(asset));
    }
  }

  private createElement(asset: MediaAsset): MediaEl {
    if (asset.kind === 'image') {
      const img = new Image();
      img.src = asset.url;
      return img;
    }
    const el = document.createElement(asset.kind === 'video' ? 'video' : 'audio');
    el.preload = 'auto';
    el.src = asset.url;
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    return el;
  }

  private disposeElement(el: MediaEl) {
    if (el instanceof HTMLMediaElement) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
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
        if (lead > 0 && lead < PRE_ROLL && !el.seeking && Math.abs(el.currentTime - clip.inPoint) > PAUSED_DRIFT_TOLERANCE) {
          el.currentTime = clip.inPoint;
        }
        continue;
      }

      const track = timeline.tracks.find((tr) => tr.id === clip.trackId);
      el.muted = !!track?.muted;
      const target = clip.inPoint + (t - clip.start);
      const drift = Math.abs(el.currentTime - target);

      if (playing) {
        if (drift > PLAYING_DRIFT_TOLERANCE) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (drift > PAUSED_DRIFT_TOLERANCE && !el.seeking) el.currentTime = target;
      }
    }
  }

  private draw(timeline: Timeline, assets: MediaAsset[], active: Clip[]) {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawBackground(timeline, assets, active);

    // Tracks are listed top to bottom; paint bottom-up so upper tracks cover lower ones.
    for (let i = timeline.tracks.length - 1; i >= 0; i--) {
      const track = timeline.tracks[i];
      if (track.kind !== 'video' || track.hidden) continue;
      for (const clip of active) {
        if (clip.trackId !== track.id) continue;
        const frame = this.drawable(clip, assets);
        if (frame) this.drawClip(clip, frame.el, frame.asset);
      }
    }
  }

  /** The element and asset to paint for a clip, or null if it has nothing ready to show. */
  private drawable(clip: Clip, assets: MediaAsset[]) {
    const el = this.elements.get(clip.id);
    const asset = assets.find((a) => a.id === clip.assetId);
    if (!el || !asset || el instanceof HTMLAudioElement) return null;
    if (el instanceof HTMLVideoElement && el.readyState < 2) return null;
    if (el instanceof HTMLImageElement && !el.complete) return null;
    return { el, asset };
  }

  private drawClip(clip: Clip, el: CanvasImageSource, asset: MediaAsset) {
    const { ctx, canvas } = this;
    const rect = clipRect(asset, clip.transform, clip.crop, canvas.width, canvas.height);
    const src = cropRect(asset.width ?? canvas.width, asset.height ?? canvas.height, clip.crop);
    ctx.save();
    ctx.globalAlpha = clip.transform.opacity;
    ctx.translate(rect.cx, rect.cy);
    ctx.rotate((rect.rotation * Math.PI) / 180);
    ctx.drawImage(el, src.sx, src.sy, src.sw, src.sh, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
    ctx.restore();
  }

  /** Fill the canvas with a solid colour, or a blurred, canvas-filling copy of the main-track frame. */
  private drawBackground(timeline: Timeline, assets: MediaAsset[], active: Clip[]) {
    const { ctx, canvas } = this;
    const bg = timeline.background;
    if (bg.type === 'color') {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const main = timeline.tracks.find((t) => t.isMain);
    const clip = main && !main.hidden && active.find((c) => c.trackId === main.id);
    const frame = clip && this.drawable(clip, assets);
    if (!clip || !frame) return;
    const src = cropRect(frame.asset.width ?? canvas.width, frame.asset.height ?? canvas.height, clip.crop);
    // Cover the canvas, overscanned slightly so the blur doesn't fade in at the edges.
    const scale = Math.max(canvas.width / src.sw, canvas.height / src.sh) * 1.1;
    const w = src.sw * scale;
    const h = src.sh * scale;
    ctx.save();
    ctx.filter = `blur(${Math.round(bg.amount * Math.max(canvas.width, canvas.height) * BLUR_RADIUS_FRACTION)}px)`;
    ctx.drawImage(frame.el, src.sx, src.sy, src.sw, src.sh, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    ctx.restore();
  }
}
