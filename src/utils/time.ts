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

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or a date. */
export function timeAgo(then: number, now = Date.now()): string {
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
