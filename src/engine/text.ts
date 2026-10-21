import type { Clip, TextData } from '../types';

/** Fonts that ship with nearly every desktop OS, so no downloads are needed. */
export const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Verdana',
  'Trebuchet MS',
  'Impact',
  'Courier New',
  'Comic Sans MS',
];

export const DEFAULT_TEXT_DURATION = 3;
const LINE_HEIGHT = 1.2;
/** Padding around the text as a fraction of the font size. */
const PAD_X = 0.3;
const PAD_Y = 0.15;
/** Longest an in or out animation runs, in seconds. */
const MAX_ANIMATION = 0.5;

export const BASE_TEXT: TextData = {
  content: 'Default text',
  fontFamily: 'Arial',
  fontSize: 72,
  color: '#ffffff',
  bold: false,
  italic: false,
  align: 'center',
  strokeColor: '#000000',
  strokeWidth: 0,
  shadow: false,
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  animationIn: 'none',
  animationOut: 'none',
};

export function fontPx(text: TextData, canvasW: number, canvasH: number): number {
  return (text.fontSize * Math.min(canvasW, canvasH)) / 1080;
}

export function cssFont(text: TextData, px: number): string {
  return `${text.italic ? 'italic ' : ''}${text.bold ? 700 : 400} ${px}px "${text.fontFamily}", sans-serif`;
}

export interface TextLayout {
  lines: string[];
  px: number;
  font: string;
  lineHeight: number;
  /** Unscaled box size in canvas pixels, including padding. */
  width: number;
  height: number;
  padX: number;
  padY: number;
}

/** Measures a string's width in pixels for a CSS font. */
export type MeasureText = (s: string, font: string) => number;

export function layoutText(text: TextData, canvasW: number, canvasH: number, measure: MeasureText): TextLayout {
  const px = fontPx(text, canvasW, canvasH);
  const font = cssFont(text, px);
  const lines = text.content.split('\n');
  const lineHeight = px * LINE_HEIGHT;
  // The outline is drawn centred on the glyph edge, so half of it extends outward.
  const outline = text.strokeWidth * px;
  const padX = px * PAD_X + outline;
  const padY = px * PAD_Y + outline;
  const textWidth = Math.max(px * 0.5, ...lines.map((l) => measure(l, font)));
  return {
    lines,
    px,
    font,
    lineHeight,
    width: textWidth + padX * 2,
    height: lines.length * lineHeight + padY * 2,
    padX,
    padY,
  };
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Browser text measurement using a shared offscreen canvas. */
export const measureWithCanvas: MeasureText = (s, font) => {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = font;
  return measureCtx.measureText(s).width;
};

/** How an animation modifies the clip at a moment in time. */
export interface AnimationFrame {
  opacity: number;
  /** Vertical offset as a fraction of the text box height. */
  offsetY: number;
  scale: number;
  /** Number of characters to reveal, or Infinity for all. */
  visibleChars: number;
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;

/** Animation state of a text clip at timeline time `t`. */
export function animateText(clip: Clip, text: TextData, t: number): AnimationFrame {
  const frame: AnimationFrame = { opacity: 1, offsetY: 0, scale: 1, visibleChars: Infinity };
  const length = Math.min(MAX_ANIMATION, clip.duration / 3);
  const sinceStart = t - clip.start;
  const untilEnd = clip.start + clip.duration - t;

  if (text.animationIn === 'typewriter') {
    // Typewriter uses the whole first half of the clip so long text has time to appear.
    const progress = Math.min(1, Math.max(0, sinceStart / (clip.duration / 2)));
    frame.visibleChars = Math.floor(text.content.length * progress);
  } else if (sinceStart < length && text.animationIn !== 'none') {
    const p = easeOut(Math.max(0, sinceStart / length));
    if (text.animationIn === 'fade') frame.opacity = p;
    if (text.animationIn === 'slide-up') {
      frame.opacity = p;
      frame.offsetY = 1 - p;
    }
    if (text.animationIn === 'pop') frame.scale = p;
  }

  if (untilEnd < length && text.animationOut !== 'none') {
    const p = easeOut(Math.max(0, untilEnd / length));
    if (text.animationOut === 'fade') frame.opacity *= p;
    if (text.animationOut === 'slide-down') {
      frame.opacity *= p;
      frame.offsetY += 1 - p;
    }
    if (text.animationOut === 'pop') frame.scale *= p;
  }
  return frame;
}

/** Lines with only the first `count` characters (newlines included) revealed. */
export function revealLines(lines: string[], count: number): string[] {
  if (!Number.isFinite(count)) return lines;
  let remaining = count;
  return lines.map((line) => {
    const shown = line.slice(0, Math.max(0, remaining));
    remaining -= line.length + 1;
    return shown;
  });
}

/**
 * Paint a laid-out text clip centred on the context's current origin.
 * The caller applies position, rotation, scale and opacity beforehand.
 */
export function paintText(ctx: CanvasRenderingContext2D, text: TextData, layout: TextLayout, lines: string[]) {
  const { width: w, height: h, px, lineHeight, padX, padY } = layout;

  if (text.backgroundOpacity > 0) {
    ctx.save();
    ctx.globalAlpha *= text.backgroundOpacity;
    ctx.fillStyle = text.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, px * 0.15);
    ctx.fill();
    ctx.restore();
  }

  ctx.font = layout.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = text.align;
  ctx.lineJoin = 'round';
  const x = text.align === 'left' ? -w / 2 + padX : text.align === 'right' ? w / 2 - padX : 0;
  lines.forEach((line, i) => {
    const y = -h / 2 + padY + lineHeight * (i + 0.5);
    if (text.strokeWidth > 0) {
      ctx.strokeStyle = text.strokeColor;
      ctx.lineWidth = text.strokeWidth * px * 2;
      ctx.strokeText(line, x, y);
    }
    ctx.save();
    if (text.shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = px * 0.15;
      ctx.shadowOffsetY = px * 0.05;
    }
    ctx.fillStyle = text.color;
    ctx.fillText(line, x, y);
    ctx.restore();
  });
}
