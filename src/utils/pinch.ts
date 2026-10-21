import { normalizeAngle } from '../engine/geometry';

export interface Point {
  x: number;
  y: number;
}

/** Distance and angle (degrees, clockwise) between two fingers. */
export function fingerSpan(a: Point, b: Point): { distance: number; angle: number } {
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

/** How a two-finger gesture changed since it started: zoom factor and twist in degrees. */
export function pinchChange(start: { distance: number; angle: number }, now: { distance: number; angle: number }) {
  return {
    scale: start.distance > 0 ? now.distance / start.distance : 1,
    rotation: normalizeAngle(now.angle - start.angle),
  };
}
