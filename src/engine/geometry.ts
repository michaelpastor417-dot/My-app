import type { Crop, MediaAsset, Transform } from '../types';

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
/** A crop can never leave less than this fraction of the source visible. */
export const MIN_CROP_REMAINDER = 0.05;

/** A clip's on-canvas box, in canvas pixels. */
export interface ClipRect {
  /** Centre point. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rotation: number;
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** The part of the source media that remains after cropping, in source pixels. */
export function cropRect(srcW: number, srcH: number, crop: Crop): SourceRect {
  return {
    sx: srcW * crop.left,
    sy: srcH * crop.top,
    sw: srcW * (1 - crop.left - crop.right),
    sh: srcH * (1 - crop.top - crop.bottom),
  };
}

/** Where a clip lands on a canvas of the given size. */
export function clipRect(
  asset: Pick<MediaAsset, 'width' | 'height'>,
  transform: Transform,
  crop: Crop,
  canvasW: number,
  canvasH: number,
): ClipRect {
  const { sw, sh } = cropRect(asset.width ?? canvasW, asset.height ?? canvasH, crop);
  const fit = Math.min(canvasW / sw, canvasH / sh) * transform.scale;
  return {
    cx: canvasW / 2 + transform.x * canvasW,
    cy: canvasH / 2 + transform.y * canvasH,
    w: sw * fit,
    h: sh * fit,
    rotation: transform.rotation,
  };
}

/** Is canvas point (px, py) inside a (possibly rotated) clip box? */
export function hitTest(rect: ClipRect, px: number, py: number): boolean {
  const rad = (-rect.rotation * Math.PI) / 180;
  const dx = px - rect.cx;
  const dy = py - rect.cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= rect.w / 2 && Math.abs(ly) <= rect.h / 2;
}

/** Angle in degrees of point (px, py) around (cx, cy), measured clockwise from "up". */
export function angleAround(cx: number, cy: number, px: number, py: number): number {
  return (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI;
}

/** Snap an angle to the nearest multiple of 90° when within `tolerance` degrees. */
export function snapRotation(deg: number, tolerance = 4): number {
  const nearest = Math.round(deg / 90) * 90 || 0; // avoid -0
  return Math.abs(deg - nearest) <= tolerance ? nearest : deg;
}

/** Normalise degrees into (-180, 180]. */
export function normalizeAngle(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** Clamp a crop so each side stays in range and enough of the source remains. */
export function clampCrop(crop: Crop): Crop {
  const max = 1 - MIN_CROP_REMAINDER;
  const left = Math.min(Math.max(crop.left, 0), max);
  const top = Math.min(Math.max(crop.top, 0), max);
  return {
    left,
    top,
    right: Math.min(Math.max(crop.right, 0), max - left),
    bottom: Math.min(Math.max(crop.bottom, 0), max - top),
  };
}
