import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ZOOM, MIN_ZOOM, useEditor } from '../store/editorStore';
import { clipEnd, timelineDuration } from '../timeline/model';
import { formatTime } from '../utils/time';
import { ASSET_DRAG_TYPE } from './MediaPanel';
import type { Clip, MediaAsset, Track } from '../types';

const HEADER_WIDTH = 120;
/** Extra empty timeline shown past the last clip so there's room to drop. */
const TAIL_SECONDS = 30;
const SNAP_PX = 8;
const DRAG_THRESHOLD_PX = 3;

interface DragState {
  clipId: string;
  pointerStartX: number;
  pointerStartY: number;
  originalStart: number;
  dx: number;
  dy: number;
  /** Snapped timeline start the clip would land at. */
  start: number;
  trackId: string;
  moved: boolean;
}

/** Pick a ruler tick spacing that keeps labels at least ~70px apart. */
function tickStep(zoom: number): number {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * zoom >= 70) ?? 600;
}

function trackIdAt(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = (el as HTMLElement).dataset?.trackId;
    if (id) return id;
  }
  return null;
}

export function Timeline() {
  const timeline = useEditor((s) => s.timeline);
  const assets = useEditor((s) => s.assets);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const currentTime = useEditor((s) => s.currentTime);
  const isPlaying = useEditor((s) => s.isPlaying);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const { seek, select, deleteSelected, addToTimeline, moveClip } = useEditor.getState();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const duration = timelineDuration(timeline);
  const contentWidth = (duration + TAIL_SECONDS) * zoom;
  const step = tickStep(zoom);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration + TAIL_SECONDS; t += step) out.push(t);
    return out;
  }, [duration, step]);

  // Keep the playhead in view during playback.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isPlaying) return;
    const x = HEADER_WIDTH + currentTime * zoom;
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - HEADER_WIDTH - 40;
  }, [currentTime, isPlaying, zoom]);

  function timeFromClientX(clientX: number): number {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft - HEADER_WIDTH) / zoom);
  }

  // ---- Ruler scrubbing ----
  function onRulerPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    useEditor.getState().setPlaying(false);
    seek(timeFromClientX(e.clientX));
  }
  function onRulerPointerMove(e: React.PointerEvent) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(timeFromClientX(e.clientX));
  }

  // ---- Clip dragging ----
  function snapStart(clip: Clip, rawStart: number): number {
    const edges = [0, currentTime];
    for (const c of timeline.clips) if (c.id !== clip.id) edges.push(c.start, clipEnd(c));
    const threshold = SNAP_PX / zoom;
    let best = rawStart;
    let bestDist = threshold;
    for (const edge of edges) {
      for (const candidate of [edge, edge - clip.duration]) {
        const d = Math.abs(candidate - rawStart);
        if (d < bestDist) {
          bestDist = d;
          best = candidate;
        }
      }
    }
    return Math.max(0, best);
  }

  function onClipPointerDown(e: React.PointerEvent, clip: Clip) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    select(clip.id);
    setDrag({
      clipId: clip.id,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      originalStart: clip.start,
      dx: 0,
      dy: 0,
      start: clip.start,
      trackId: clip.trackId,
      moved: false,
    });
  }

  function onClipPointerMove(e: React.PointerEvent, clip: Clip) {
    if (!drag || drag.clipId !== clip.id) return;
    const dx = e.clientX - drag.pointerStartX;
    const dy = e.clientY - drag.pointerStartY;
    const moved = drag.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
    const start = snapStart(clip, drag.originalStart + dx / zoom);
    setDrag({
      ...drag,
      dx: (start - drag.originalStart) * zoom,
      dy,
      start,
      trackId: trackIdAt(e.clientX, e.clientY) ?? drag.trackId,
      moved,
    });
  }

  function onClipPointerUp() {
    if (drag?.moved) moveClip(drag.clipId, drag.start, drag.trackId);
    setDrag(null);
  }

  // ---- Dropping media from the library ----
  function acceptsAsset(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    return true;
  }
  function onDropAsset(e: React.DragEvent, trackId: string) {
    if (!acceptsAsset(e)) return;
    e.stopPropagation();
    addToTimeline(e.dataTransfer.getData(ASSET_DRAG_TYPE), { trackId, at: timeFromClientX(e.clientX) });
  }

  const hasClips = timeline.clips.length > 0;

  return (
    <section className="timeline">
      <div className="timeline-toolbar">
        <button className="tool-btn" onClick={deleteSelected} disabled={!selectedClipId} title="Delete (Del)">
          🗑 Delete
        </button>
        <button className="tool-btn" disabled title="Split arrives in the next step">
          ✂ Split
        </button>
        <div className="toolbar-spacer" />
        <label className="zoom-control" title="Zoom (Ctrl + scroll)">
          <span>−</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <span>+</span>
        </label>
      </div>

      <div
        className="timeline-scroll"
        ref={scrollRef}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
          }
        }}
        onPointerDown={() => select(null)}
      >
        <div className="timeline-content" style={{ width: HEADER_WIDTH + contentWidth }}>
          <div className="ruler-row">
            <div className="track-header ruler-corner" style={{ width: HEADER_WIDTH }} />
            <div
              className="ruler"
              onPointerDown={(e) => {
                e.stopPropagation();
                onRulerPointerDown(e);
              }}
              onPointerMove={onRulerPointerMove}
            >
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * zoom }}>
                  <span>{formatTime(t)}</span>
                </div>
              ))}
            </div>
          </div>

          <NewTrackZone label="Drop here to add an overlay track" onDrop={(e) => onDropAsset(e, 'new')} accepts={acceptsAsset} />

          {timeline.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              clips={timeline.clips.filter((c) => c.trackId === track.id)}
              assets={assets}
              zoom={zoom}
              selectedClipId={selectedClipId}
              drag={drag}
              isDropTarget={!!drag?.moved && drag.trackId === track.id}
              onClipPointerDown={onClipPointerDown}
              onClipPointerMove={onClipPointerMove}
              onClipPointerUp={onClipPointerUp}
              onDragOver={acceptsAsset}
              onDrop={(e) => onDropAsset(e, track.id)}
              emptyHint={track.isMain && !hasClips}
            />
          ))}

          <NewTrackZone label="Drop audio here" onDrop={(e) => onDropAsset(e, 'new')} accepts={acceptsAsset} />

          <div className="playhead" style={{ left: HEADER_WIDTH + currentTime * zoom }}>
            <div className="playhead-head" />
          </div>
        </div>
      </div>
    </section>
  );
}

function NewTrackZone(props: {
  label: string;
  accepts: (e: React.DragEvent) => boolean;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`new-track-zone ${over ? 'over' : ''}`}
      onDragOver={(e) => setOver(props.accepts(e))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        props.onDrop(e);
      }}
    >
      <div className="track-header" style={{ width: HEADER_WIDTH }} />
      {over && <span className="new-track-label">{props.label}</span>}
    </div>
  );
}

function TrackRow(props: {
  track: Track;
  clips: Clip[];
  assets: MediaAsset[];
  zoom: number;
  selectedClipId: string | null;
  drag: DragState | null;
  isDropTarget: boolean;
  emptyHint: boolean;
  onClipPointerDown: (e: React.PointerEvent, clip: Clip) => void;
  onClipPointerMove: (e: React.PointerEvent, clip: Clip) => void;
  onClipPointerUp: () => void;
  onDragOver: (e: React.DragEvent) => boolean;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { track, zoom, drag } = props;
  const label = track.isMain ? 'Main' : track.kind === 'audio' ? 'Audio' : 'Overlay';
  return (
    <div className={`track-row ${track.kind} ${track.isMain ? 'main' : ''}`}>
      <div className="track-header" style={{ width: HEADER_WIDTH }}>
        <span className="track-icon">{track.kind === 'audio' ? '♪' : '▣'}</span>
        {label}
      </div>
      <div
        className={`track-lane ${props.isDropTarget ? 'drop-target' : ''}`}
        data-track-id={track.id}
        onDragOver={props.onDragOver}
        onDrop={props.onDrop}
      >
        {props.emptyHint && <span className="lane-hint">Drag media here or press + on a file to start editing</span>}
        {props.clips.map((clip) => {
          const asset = props.assets.find((a) => a.id === clip.assetId);
          const dragging = drag?.clipId === clip.id && drag.moved;
          return (
            <div
              key={clip.id}
              className={`clip ${asset?.kind ?? ''} ${props.selectedClipId === clip.id ? 'selected' : ''} ${
                dragging ? 'dragging' : ''
              }`}
              style={{
                left: clip.start * zoom,
                width: Math.max(4, clip.duration * zoom),
                backgroundImage: asset?.thumbnail ? `url(${asset.thumbnail})` : undefined,
                transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
              }}
              onPointerDown={(e) => props.onClipPointerDown(e, clip)}
              onPointerMove={(e) => props.onClipPointerMove(e, clip)}
              onPointerUp={props.onClipPointerUp}
              onPointerCancel={props.onClipPointerUp}
            >
              <span className="clip-label">
                {asset?.name} · {formatTime(clip.duration)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
