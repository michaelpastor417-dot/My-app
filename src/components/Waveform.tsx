import { useEffect, useMemo, useRef } from 'react';
import { waveformBars } from '../engine/audio';

const BAR_STEP = 3; // px between bar starts
const BAR_WIDTH = 2;
/** Canvases wider than this are stretched by CSS instead, to bound memory on very long clips. */
const MAX_CANVAS_WIDTH = 4096;

/** Draws the source span [from, to) seconds of a waveform as bars filling its box. */
export function Waveform(props: { peaks: number[]; from: number; to: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, Math.min(MAX_CANVAS_WIDTH, Math.round(props.width)));
  const { peaks, from, to, height } = props;
  // Scale to the file's loudest moment so quiet recordings still show a readable shape.
  const loudest = useMemo(() => peaks.reduce((m, p) => Math.max(m, p), 0) || 1, [peaks]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    const bars = waveformBars(peaks, from, to, Math.floor(width / BAR_STEP));
    bars.forEach((level, i) => {
      const h = Math.max(1, (level / loudest) * height);
      ctx.fillRect(i * BAR_STEP, (height - h) / 2, BAR_WIDTH, h);
    });
  }, [peaks, from, to, width, height, loudest]);

  return <canvas ref={ref} className="waveform" width={width} height={height} />;
}
