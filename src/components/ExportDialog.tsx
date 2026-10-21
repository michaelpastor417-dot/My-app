import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { timelineDuration } from '../timeline/model';
import { CODEC_NAMES, type ExportProgress, type ExportResult, exportVideo } from '../export/exporter';
import {
  FRAME_RATES,
  type QualityLevel,
  RESOLUTIONS,
  type Resolution,
  estimateBytes,
  exportSize,
} from '../export/settings';
import { formatTime } from '../utils/time';

type Stage =
  | { kind: 'settings' }
  | { kind: 'running'; progress: ExportProgress; startedAt: number }
  | { kind: 'done'; result: ExportResult; url: string; fileName: string; seconds: number }
  | { kind: 'error'; message: string };

const PHASES: Record<ExportProgress['phase'], string> = {
  preparing: 'Preparing…',
  audio: 'Mixing audio…',
  video: 'Rendering video…',
  finalizing: 'Finishing file…',
};

function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

function download(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const aspectRatio = useEditor((s) => s.aspectRatio);
  const duration = useEditor((s) => timelineDuration(s.timeline));
  const [name, setName] = useState('ClipForge export');
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState<QualityLevel>('recommended');
  const [stage, setStage] = useState<Stage>({ kind: 'settings' });
  const abortRef = useRef<AbortController | null>(null);
  /** The finished file's object URL, freed when replaced or when the dialog closes. */
  const urlRef = useRef<string | null>(null);
  const { width, height } = exportSize(aspectRatio, resolution);

  // Only on close (unmount): stop a running export and free the file's memory.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function start() {
    const { timeline, assets, setPlaying } = useEditor.getState();
    setPlaying(false);
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    setStage({ kind: 'running', progress: { phase: 'preparing', progress: 0 }, startedAt });
    try {
      const result = await exportVideo(
        timeline,
        assets,
        { width, height, fps, quality },
        (progress) => setStage({ kind: 'running', progress, startedAt }),
        controller.signal,
      );
      const fileName = `${name.trim() || 'ClipForge export'}.mp4`;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      download(url, fileName);
      setStage({ kind: 'done', result, url, fileName, seconds: (performance.now() - startedAt) / 1000 });
    } catch (error) {
      if ((error as Error).name === 'AbortError') setStage({ kind: 'settings' });
      else setStage({ kind: 'error', message: (error as Error).message || 'Export failed.' });
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && stage.kind !== 'running' && onClose()}>
      <div className="modal export-dialog" role="dialog" aria-label="Export">
        <header className="modal-header">
          <h3>Export</h3>
          {stage.kind !== 'running' && (
            <button className="modal-close" onClick={onClose} title="Close">
              ×
            </button>
          )}
        </header>

        {stage.kind === 'settings' && (
          <div className="modal-body">
            <label className="field export-field">
              <span>Name</span>
              <input className="text-field" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field export-field">
              <span>Resolution</span>
              <select value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
                {Object.keys(RESOLUTIONS).map((r) => {
                  const size = exportSize(aspectRatio, r as Resolution);
                  return (
                    <option key={r} value={r}>
                      {r} ({size.width}×{size.height})
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="field export-field">
              <span>Frame rate</span>
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                {FRAME_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r} fps
                  </option>
                ))}
              </select>
            </label>
            <div className="field export-field">
              <span>Quality</span>
              <div className="segmented">
                {(['low', 'recommended', 'high'] as const).map((q) => (
                  <button key={q} className={quality === q ? 'active' : ''} onClick={() => setQuality(q)}>
                    {q[0].toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <p className="section-note">
              Length {formatTime(duration, true)} · about {formatBytes(estimateBytes(width, height, fps, duration, quality))} ·
              MP4
            </p>
            <footer className="modal-footer">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={start} disabled={duration === 0}>
                Export
              </button>
            </footer>
          </div>
        )}

        {stage.kind === 'running' && <Running stage={stage} onCancel={() => abortRef.current?.abort()} />}

        {stage.kind === 'done' && (
          <div className="modal-body">
            <video className="export-preview" src={stage.url} controls />
            <p className="export-summary">
              <strong>{stage.fileName}</strong> · {formatBytes(stage.result.blob.size)} · {width}×{height} {fps}fps ·{' '}
              {CODEC_NAMES[stage.result.videoCodec]}
              {stage.result.audioCodec && ` / ${CODEC_NAMES[stage.result.audioCodec]}`} · made in{' '}
              {stage.seconds.toFixed(1)}s
            </p>
            {stage.result.videoCodec !== 'avc' && (
              <p className="section-note">
                This browser can't make H.264 video, so the file uses {CODEC_NAMES[stage.result.videoCodec]}. It plays in
                Chrome, Firefox, Edge and VLC, but some apps (like QuickTime) may not open it. Chrome or Edge on Windows/Mac
                produce H.264.
              </p>
            )}
            <footer className="modal-footer">
              <button className="btn" onClick={() => setStage({ kind: 'settings' })}>
                Export again
              </button>
              <button className="btn btn-primary" onClick={() => download(stage.url, stage.fileName)}>
                Download
              </button>
            </footer>
          </div>
        )}

        {stage.kind === 'error' && (
          <div className="modal-body">
            <p className="export-error">{stage.message}</p>
            <footer className="modal-footer">
              <button className="btn" onClick={onClose}>
                Close
              </button>
              <button className="btn btn-primary" onClick={() => setStage({ kind: 'settings' })}>
                Try again
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

function Running({ stage, onCancel }: { stage: Extract<Stage, { kind: 'running' }>; onCancel: () => void }) {
  const { progress, startedAt } = stage;
  const elapsed = (performance.now() - startedAt) / 1000;
  const remaining = progress.progress > 0.08 ? (elapsed / progress.progress) * (1 - progress.progress) : null;
  return (
    <div className="modal-body">
      <div className="progress-label">
        <span>{PHASES[progress.phase]}</span>
        <span>{Math.floor(progress.progress * 100)}%</span>
      </div>
      <div className="progress-bar">
        <div style={{ width: `${progress.progress * 100}%` }} />
      </div>
      <p className="section-note">
        {progress.frames ? `Frame ${progress.frame} of ${progress.frames}` : ' '}
        {remaining !== null && ` · about ${Math.ceil(remaining)}s left`}
      </p>
      <footer className="modal-footer">
        <button className="btn" onClick={onCancel}>
          Cancel export
        </button>
      </footer>
    </div>
  );
}
