import { describe, expect, it } from 'vitest';
import { BASE_TEXT, animateText, fontPx, layoutText, revealLines } from './text';
import { DEFAULT_TRANSFORM, NO_CROP } from './geometry';
import { DEFAULT_AUDIO } from './audio';
import type { Clip, TextData } from '../types';

/** Fake measurer: every character is half the font size wide. */
const measure = (s: string, font: string) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
  return s.length * px * 0.5;
};

const clip: Clip = { id: 't', trackId: 'tx', start: 10, inPoint: 0, speed: 1, duration: 3, transform: DEFAULT_TRANSFORM, crop: NO_CROP, audio: DEFAULT_AUDIO };
const text = (patch: Partial<TextData>): TextData => ({ ...BASE_TEXT, ...patch });

describe('fontPx', () => {
  it('scales with the canvas shorter side', () => {
    expect(fontPx(text({ fontSize: 100 }), 1920, 1080)).toBe(100);
    expect(fontPx(text({ fontSize: 100 }), 1080, 1920)).toBe(100);
    expect(fontPx(text({ fontSize: 100 }), 720, 720)).toBeCloseTo(66.667);
  });
});

describe('layoutText', () => {
  it('sizes the box to the widest line plus padding', () => {
    const l = layoutText(text({ content: 'abcd\nab', fontSize: 100 }), 1920, 1080, measure);
    expect(l.lines).toEqual(['abcd', 'ab']);
    expect(l.width).toBeCloseTo(200 + 2 * 30); // 4 chars * 50px + padding
    expect(l.height).toBeCloseTo(2 * 120 + 2 * 15);
  });

  it('grows the padding to fit the outline', () => {
    const plain = layoutText(text({ fontSize: 100 }), 1920, 1080, measure);
    const outlined = layoutText(text({ fontSize: 100, strokeWidth: 0.1 }), 1920, 1080, measure);
    expect(outlined.width - plain.width).toBeCloseTo(20);
  });

  it('includes bold and italic in the font', () => {
    expect(layoutText(text({ bold: true, italic: true }), 1920, 1080, measure).font).toMatch(/^italic 700 /);
  });
});

describe('animateText', () => {
  it('is fully visible with no animation', () => {
    expect(animateText(clip, text({}), 11)).toEqual({ opacity: 1, offsetY: 0, scale: 1, visibleChars: Infinity });
  });

  it('fades in over the first half second', () => {
    const t = text({ animationIn: 'fade' });
    expect(animateText(clip, t, 10).opacity).toBe(0);
    expect(animateText(clip, t, 10.25).opacity).toBeGreaterThan(0.5);
    expect(animateText(clip, t, 10.6).opacity).toBe(1);
  });

  it('slides up from below and fades out at the end', () => {
    const t = text({ animationIn: 'slide-up', animationOut: 'fade' });
    expect(animateText(clip, t, 10).offsetY).toBe(1);
    expect(animateText(clip, t, 12.9).opacity).toBeLessThan(0.5);
  });

  it('pops out to zero scale', () => {
    expect(animateText(clip, text({ animationOut: 'pop' }), 13).scale).toBe(0);
  });

  it('types the text out over the first half of the clip', () => {
    const t = text({ content: 'abcdef', animationIn: 'typewriter' });
    expect(animateText(clip, t, 10).visibleChars).toBe(0);
    expect(animateText(clip, t, 10.75).visibleChars).toBe(3);
    expect(animateText(clip, t, 12).visibleChars).toBe(6);
  });

  it('keeps short clips animating within a third of their length', () => {
    const short = { ...clip, duration: 0.6 };
    expect(animateText(short, text({ animationIn: 'fade' }), 10.2).opacity).toBe(1);
  });
});

describe('revealLines', () => {
  it('reveals characters across lines, counting newlines', () => {
    expect(revealLines(['abc', 'de'], 2)).toEqual(['ab', '']);
    expect(revealLines(['abc', 'de'], 5)).toEqual(['abc', 'd']);
    expect(revealLines(['abc', 'de'], Infinity)).toEqual(['abc', 'de']);
  });
});
