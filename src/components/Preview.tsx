import { useEffect, useRef } from 'react';
import { ASPECT_RATIOS, type AspectRatio, useEditor } from '../store/editorStore';
import { PlaybackEngine } from '../engine/PlaybackEngine';
import { timelineDuration } from '../timeline/model';
import { formatTime } from '../utils/time';

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aspectRatio = useEditor((s) => s.aspectRatio);
  const setAspectRatio = useEditor((s) => s.setAspectRatio);
  const isPlaying = useEditor((s) => s.isPlaying);
  const togglePlay = useEditor((s) => s.togglePlay);
  const currentTime = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => timelineDuration(s.timeline));
  const [width, height] = ASPECT_RATIOS[aspectRatio];

  useEffect(() => {
    const engine = new PlaybackEngine(canvasRef.current!);
    return () => engine.destroy();
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
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onClick={togglePlay}
        />
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
