import { describe, expect, it } from 'vitest';
import { fingerSpan, pinchChange } from './pinch';

describe('two-finger gestures', () => {
  it('measures spreading fingers as zoom', () => {
    const start = fingerSpan({ x: 0, y: 0 }, { x: 100, y: 0 });
    const now = fingerSpan({ x: -50, y: 0 }, { x: 150, y: 0 });
    expect(pinchChange(start, now)).toEqual({ scale: 2, rotation: 0 });
  });

  it('measures twisting fingers as rotation, clockwise positive', () => {
    const start = fingerSpan({ x: 0, y: 0 }, { x: 100, y: 0 });
    const now = fingerSpan({ x: 0, y: 0 }, { x: 0, y: 100 }); // second finger swept down: clockwise on screen
    const change = pinchChange(start, now);
    expect(change.rotation).toBeCloseTo(90);
    expect(change.scale).toBeCloseTo(1);
  });

  it('keeps rotation continuous across the ±180° seam', () => {
    const start = fingerSpan({ x: 0, y: 0 }, { x: -100, y: 1 }); // ~180°
    const now = fingerSpan({ x: 0, y: 0 }, { x: -100, y: -1 }); // ~-180°
    expect(Math.abs(pinchChange(start, now).rotation)).toBeLessThan(2);
  });
});
