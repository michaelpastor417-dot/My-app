import type { Clip, MediaAsset, Timeline } from '../types';
import { clipRect, cropRect } from './geometry';
import { transformAt } from '../timeline/animation';
import { resolveLook } from '../timeline/look';
import { type ActiveTransition, TRANSITION_CODES, transitionAt } from '../timeline/transitions';
import { getGpu } from './gpu';
import { BackgroundRemover } from '../ai/segmenter';
import { animateText, layoutText, measureWithCanvas, paintText, revealLines } from './text';

/** Longest side, in pixels, that a clip is colour-graded at on the GPU. */
const MAX_GPU_SIZE = 2048;
/** Blur radius at background blur amount 1, as a fraction of the canvas's longer side. */
const BLUR_RADIUS_FRACTION = 0.06;

export type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

/**
 * Draws one frame of the timeline onto a canvas: background, every visible
 * track bottom-up, text, GPU looks and transitions. Shared by live preview
 * and export so both produce the same picture; the caller supplies each
 * clip's media element, already showing the right frame.
 */
export class Compositor {
  private ctx: CanvasRenderingContext2D;
  /** Offscreen layers the two clips of a transition are painted onto before blending. */
  private layers: CanvasRenderingContext2D[] = [];
  private backgroundRemover = new BackgroundRemover();

  constructor(
    private canvas: HTMLCanvasElement,
    private sourceOf: (clipId: string) => MediaEl | undefined,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Paint the frame at timeline time `t`; `active` are the clips at that time. */
  draw(timeline: Timeline, assets: MediaAsset[], active: Clip[], t: number) {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawBackground(timeline, assets, active);

    const transition = transitionAt(timeline, t);
    // Tracks are listed top to bottom; paint bottom-up so upper tracks cover lower ones.
    for (let i = timeline.tracks.length - 1; i >= 0; i--) {
      const track = timeline.tracks[i];
      if (track.kind === 'audio' || track.hidden) continue;
      if (track.isMain && transition) {
        this.drawTransition(transition, assets, t);
        continue;
      }
      for (const clip of active) {
        if (clip.trackId === track.id) this.drawAny(ctx, clip, assets, t);
      }
    }
  }

  private drawAny(ctx: CanvasRenderingContext2D, clip: Clip, assets: MediaAsset[], t: number) {
    if (clip.text) {
      this.drawText(ctx, clip, t);
      return;
    }
    const frame = this.drawable(clip, assets);
    if (frame) this.drawClip(ctx, clip, frame.el, frame.asset, t);
  }

  /**
   * Paint both clips of a main-track transition onto their own canvas-sized
   * layers and blend them on the GPU (or crossfade without WebGL).
   */
  private drawTransition(transition: ActiveTransition, assets: MediaAsset[], t: number) {
    const { ctx, canvas } = this;
    const [from, to] = [this.layer(0), this.layer(1)];
    this.drawAny(from, transition.from, assets, t);
    this.drawAny(to, transition.to, assets, t);
    const gpu = getGpu();
    if (gpu) {
      const code = TRANSITION_CODES[transition.type];
      ctx.drawImage(gpu.transition(from.canvas, to.canvas, code, transition.progress, canvas.width, canvas.height), 0, 0);
      return;
    }
    ctx.save();
    ctx.globalAlpha = 1 - transition.progress;
    ctx.drawImage(from.canvas, 0, 0);
    ctx.globalAlpha = transition.progress;
    ctx.drawImage(to.canvas, 0, 0);
    ctx.restore();
  }

  /** A cleared, canvas-sized offscreen layer for transitions. */
  private layer(i: number): CanvasRenderingContext2D {
    const { canvas } = this;
    this.layers[i] ??= document.createElement('canvas').getContext('2d')!;
    const layer = this.layers[i];
    if (layer.canvas.width !== canvas.width || layer.canvas.height !== canvas.height) {
      layer.canvas.width = canvas.width;
      layer.canvas.height = canvas.height;
    } else {
      layer.clearRect(0, 0, canvas.width, canvas.height);
    }
    return layer;
  }

  /** The element and asset to paint for a clip, or null if it has nothing ready to show. */
  private drawable(clip: Clip, assets: MediaAsset[]) {
    const el = this.sourceOf(clip.id);
    const asset = assets.find((a) => a.id === clip.assetId);
    if (!el || !asset || el instanceof HTMLAudioElement) return null;
    if (el instanceof HTMLVideoElement && el.readyState < 2) return null;
    if (el instanceof HTMLImageElement && !el.complete) return null;
    return { el, asset };
  }

  private drawClip(ctx: CanvasRenderingContext2D, clip: Clip, el: CanvasImageSource, asset: MediaAsset, t: number) {
    const { canvas } = this;
    const transform = transformAt(clip, t);
    const rect = clipRect(asset, transform, clip.crop, canvas.width, canvas.height);
    const sourceW = asset.width ?? canvas.width;
    const sourceH = asset.height ?? canvas.height;
    // With background removal the person cut-out (possibly downscaled by `k`) stands in for the frame.
    let source: CanvasImageSource = el;
    let k = 1;
    if (clip.removeBackground && (el instanceof HTMLVideoElement || el instanceof HTMLImageElement)) {
      const frameKey = el instanceof HTMLVideoElement ? el.currentTime.toFixed(4) : 'still';
      const cut = this.backgroundRemover.cutout(clip.id, el, sourceW, sourceH, frameKey);
      if (cut) {
        source = cut.canvas;
        k = cut.scale;
      }
    }
    const crop = cropRect(sourceW, sourceH, clip.crop);
    const src = { sx: crop.sx * k, sy: crop.sy * k, sw: crop.sw * k, sh: crop.sh * k };
    const look = resolveLook(clip);
    const gpu = look && getGpu();
    ctx.save();
    ctx.globalAlpha = transform.opacity;
    ctx.translate(rect.cx, rect.cy);
    ctx.rotate((rect.rotation * Math.PI) / 180);
    if (look && gpu) {
      // Grade at source resolution (capped), then let the 2D canvas place and scale the result.
      const cap = Math.min(1, MAX_GPU_SIZE / Math.max(src.sw, src.sh));
      const outW = Math.max(1, Math.round(src.sw * cap));
      const outH = Math.max(1, Math.round(src.sh * cap));
      const graded = gpu.processClip(source as TexImageSource, sourceW * k, sourceH * k, src, look, t, outW, outH);
      ctx.drawImage(graded, 0, 0, outW, outH, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
    } else {
      ctx.drawImage(source, src.sx, src.sy, src.sw, src.sh, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
    }
    ctx.restore();
  }

  private drawText(ctx: CanvasRenderingContext2D, clip: Clip, t: number) {
    const text = clip.text!;
    const { canvas } = this;
    const layout = layoutText(text, canvas.width, canvas.height, measureWithCanvas);
    const anim = animateText(clip, text, t);
    const { x, y, scale, rotation, opacity } = transformAt(clip, t);
    ctx.save();
    ctx.globalAlpha = opacity * anim.opacity;
    ctx.translate(
      canvas.width / 2 + x * canvas.width,
      canvas.height / 2 + y * canvas.height + anim.offsetY * layout.height * scale,
    );
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale * anim.scale, scale * anim.scale);
    paintText(ctx, text, layout, revealLines(layout.lines, anim.visibleChars));
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
