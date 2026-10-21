import { describe, expect, it } from 'vitest';
import { resolveLook } from './look';

describe('resolveLook', () => {
  it('needs no processing for an untouched clip', () => {
    expect(resolveLook({})).toBeNull();
    expect(resolveLook({ adjust: { brightness: 0 } })).toBeNull();
    expect(resolveLook({ effect: { id: 'blur', intensity: 0 } })).toBeNull();
  });

  it('scales manual adjustments to -1..1', () => {
    expect(resolveLook({ adjust: { brightness: 50, contrast: -100 } })!.adjust).toMatchObject({ brightness: 0.5, contrast: -1 });
  });

  it('applies a filter at its intensity and adds manual adjustments on top', () => {
    // B&W: saturation -100, contrast +10
    const look = resolveLook({ filter: { id: 'bw', intensity: 0.5 }, adjust: { contrast: 20 } })!;
    expect(look.adjust.saturation).toBeCloseTo(-0.5);
    expect(look.adjust.contrast).toBeCloseTo(0.25);
  });

  it('clamps combined values to the valid range', () => {
    const look = resolveLook({ filter: { id: 'bw', intensity: 1 }, adjust: { saturation: -80, sharpen: -50 } })!;
    expect(look.adjust.saturation).toBe(-1);
    expect(look.adjust.sharpen).toBe(0);
  });

  it('scales split toning with filter intensity', () => {
    const look = resolveLook({ filter: { id: 'cinematic', intensity: 0.5 } })!;
    expect(look.splitShadows[2]).toBeCloseTo(0.04);
  });

  it('passes effects through with their shader code', () => {
    expect(resolveLook({ effect: { id: 'glitch', intensity: 0.7 } })).toMatchObject({ effect: 3, effectIntensity: 0.7 });
  });
});
