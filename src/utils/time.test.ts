import { describe, expect, it } from 'vitest';
import { formatTime, timeAgo } from './time';

describe('formatTime', () => {
  it('formats minutes, seconds and frames', () => {
    expect(formatTime(75.5)).toBe('01:15');
    expect(formatTime(75.5, true)).toBe('01:15:15');
  });
});

describe('timeAgo', () => {
  const now = Date.UTC(2026, 9, 21, 12);
  it('describes recent edits in plain words', () => {
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 30 * 3600_000, now)).toBe('yesterday');
    expect(timeAgo(now - 4 * 86400_000, now)).toBe('4 days ago');
  });
});
