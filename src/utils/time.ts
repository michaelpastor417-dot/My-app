/** Format seconds as mm:ss or mm:ss:ff (frames at 30fps), like CapCut's timecode. */
export function formatTime(seconds: number, withFrames = false): string {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const base = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  if (!withFrames) return base;
  const ff = Math.floor((s % 1) * 30);
  return `${base}:${String(ff).padStart(2, '0')}`;
}
