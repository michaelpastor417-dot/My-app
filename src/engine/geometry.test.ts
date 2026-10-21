import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFORM,
  NO_CROP,
  angleAround,
  clampCrop,
  clipRect,
  cropRect,
  hitTest,
  normalizeAngle,
  snapRotation,
} from './geometry';

const wide = { width: 1920, height: 1080 };
const square = { width: 500, height: 500 };

describe('clipRect', () => {
  it('fits media inside the canvas at scale 1', () => {
    expect(clipRect(wide, DEFAULT_TRANSFORM, NO_CROP, 1920, 1080)).toEqual({ cx: 960, cy: 540, w: 1920, h: 1080, rotation: 0 });
    // 16:9 media on a 9:16 canvas is letterboxed to the canvas width.
    const r = clipRect(wide, DEFAULT_TRANSFORM, NO_CROP, 1080, 1920);
    expect([r.w, r.h]).toEqual([1080, 607.5]);
  });

  it('applies position as a fraction of canvas size, and scale', () => {
    const r = clipRect(square, { ...DEFAULT_TRANSFORM, x: 0.25, y: -0.5, scale: 0.5 }, NO_CROP, 1920, 1080);
    expect(r).toMatchObject({ cx: 1440, cy: 0, w: 540, h: 540 });
  });

  it('fits the cropped region, not the full source', () => {
    const crop = { left: 0.25, right: 0.25, top: 0, bottom: 0 }; // 960x1080 remains
    const r = clipRect(wide, DEFAULT_TRANSFORM, crop, 1920, 1080);
    expect([r.w, r.h]).toEqual([960, 1080]);
  });
});

describe('cropRect', () => {
  it('returns the remaining source region', () => {
    expect(cropRect(100, 200, { left: 0.1, top: 0.25, right: 0.2, bottom: 0.25 })).toEqual({ sx: 10, sy: 50, sw: 70, sh: 100 });
  });
});

describe('hitTest', () => {
  const rect = { cx: 100, cy: 100, w: 100, h: 20, rotation: 0 };
  it('hits inside an unrotated box', () => {
    expect(hitTest(rect, 140, 105)).toBe(true);
    expect(hitTest(rect, 100, 120)).toBe(false);
  });
  it('accounts for rotation', () => {
    const rotated = { ...rect, rotation: 90 };
    expect(hitTest(rotated, 100, 140)).toBe(true);
    expect(hitTest(rotated, 140, 100)).toBe(false);
  });
});

describe('angles', () => {
  it('measures clockwise from up', () => {
    expect(angleAround(0, 0, 0, -1)).toBeCloseTo(0);
    expect(angleAround(0, 0, 1, 0)).toBeCloseTo(90);
    expect(angleAround(0, 0, 0, 1)).toBeCloseTo(180);
  });
  it('snaps near right angles only', () => {
    expect(snapRotation(88)).toBe(90);
    expect(snapRotation(-3)).toBe(0);
    expect(snapRotation(45)).toBe(45);
  });
  it('normalises into (-180, 180]', () => {
    expect(normalizeAngle(270)).toBe(-90);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(180)).toBe(180);
  });
});

describe('clampCrop', () => {
  it('keeps at least a sliver of the source', () => {
    const c = clampCrop({ left: 0.7, right: 0.7, top: -1, bottom: 0 });
    expect(c.left).toBe(0.7);
    expect(c.right).toBeCloseTo(0.25);
    expect(c.top).toBe(0);
  });
});
