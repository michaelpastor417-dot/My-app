import { useEffect, useRef, useState } from 'react';
import { ASPECT_RATIOS, type AspectRatio, useEditor } from '../store/editorStore';
import { PlaybackEngine } from '../engine/PlaybackEngine';
import { timelineDuration } from '../timeline/model';
import { formatTime } from '../utils/time';
import { TransformOverlay } from './TransformOverlay';

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aspectRatio = useEditor((s) => s.aspectRatio);
  const setAspectRatio = useEditor((s) => s.setAspectRatio);
  const isPlaying = useEditor((s) => s.isPlaying);
  const togglePlay = useEditor((s) => s.togglePlay);
  const currentTime = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => timelineDuration(s.timeline));
  const [width, height] = ASPECT_RATIOS[aspectRatio];

  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);

  useEffect(() => {
    const engine = new PlaybackEngine(canvasRef.current!);
    // Exposed in development so browser tests can inspect playback state.
    if (import.meta.env.DEV) Object.assign(window, { __engine: engine, __editor: useEditor });
    return () => engine.destroy();
  }, []);

  // Track the on-screen size of the canvas so the overlay can map screen pixels to canvas pixels.
  useEffect(() => {
    const frame = frameRef.current!;
    const observer = new ResizeObserver(() => setFrameWidth(frame.clientWidth));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="panel preview">
      <div className="preview-header">
        <span>Player</span>
        <select
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
          title="Canvas ratio"
        >
          {Object.keys(ASPECT_RATIOS).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="preview-stage">
        <div
          ref={frameRef}
          className="preview-frame"
          style={{ '--frame-ratio': width / height, aspectRatio: `${width} / ${height}` } as React.CSSProperties}
        >
          <canvas ref={canvasRef} width={width} height={height} />
          {frameWidth > 0 && <TransformOverlay displayScale={frameWidth / width} />}
        </div>
      </div>
      <div className="preview-controls">
        <span className="timecode">
          <strong>{formatTime(currentTime, true)}</strong> / {formatTime(duration, true)}
        </span>
        <button className="play-btn" onClick={togglePlay} disabled={duration === 0} title="Play/Pause (Space)">
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <span className="timecode-spacer" />
      </div>
    </section>
  );
}
