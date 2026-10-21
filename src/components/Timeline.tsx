import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ZOOM, MIN_ZOOM, isClipLocked, useEditor } from '../store/editorStore';
import { clipEnd, timelineDuration } from '../timeline/model';
import { formatTime } from '../utils/time';
import { trackDrag } from '../utils/drag';
import { ASSET_DRAG_TYPE, TEXT_DRAG_TYPE } from './MediaPanel';
import type { Clip, MediaAsset, Track } from '../types';

const HEADER_WIDTH = 150;
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
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const selectedLocked = useEditor((s) => {
    const clip = s.timeline.clips.find((c) => c.id === s.selectedClipId);
    return !clip || isClipLocked(s.timeline, clip);
  });
  const { seek, select, deleteSelected, addToTimeline, moveClip, undo, redo, splitAtPlayhead, duplicateSelected } =
    useEditor.getState();

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

  // ---- Snapping ----
  /** Edges a dragged clip or trim handle can snap to: zero, the playhead and every other clip's ends. */
  function snapEdges(excludeId: string): number[] {
    const edges = [0, currentTime];
    for (const c of timeline.clips) if (c.id !== excludeId) edges.push(c.start, clipEnd(c));
    return edges;
  }

  /** Snap `raw` to the nearest candidate within SNAP_PX, or return it unchanged. */
  function snap(raw: number, candidates: number[]): number {
    let best = raw;
    let bestDist = SNAP_PX / zoom;
    for (const candidate of candidates) {
      const d = Math.abs(candidate - raw);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    return best;
  }

  // ---- Clip dragging ----
  function snapStart(clip: Clip, rawStart: number): number {
    // Snap either the clip's start or its end to an edge.
    const edges = snapEdges(clip.id);
    const candidates = [...edges, ...edges.map((e) => e - clip.duration)];
    return Math.max(0, snap(rawStart, candidates));
  }

  function onClipPointerDown(e: React.PointerEvent, clip: Clip) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (isClipLocked(timeline, clip)) {
      select(null);
      return;
    }
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

  // ---- Trimming ----
  // Tracked with window listeners: a trim re-lays out the track, and the
  // browser drops pointer capture if React moves the element.
  function onTrimPointerDown(e: React.PointerEvent, clip: Clip, edge: 'start' | 'end') {
    if (e.button !== 0) return;
    e.stopPropagation();
    const store = useEditor.getState();
    store.setPlaying(false);
    store.beginGesture();
    const pointerStartX = e.clientX;
    const edgeTime = edge === 'start' ? clip.start : clipEnd(clip);
    const edges = snapEdges(clip.id);

    trackDrag(
      (ev) => {
        const raw = edgeTime + (ev.clientX - pointerStartX) / zoom;
        useEditor.getState().trimGesture(clip.id, edge, snap(raw, edges));
      },
      () => useEditor.getState().endGesture(),
    );
  }

  // ---- Dropping media from the library ----
  function acceptsAsset(e: React.DragEvent) {
    const types = e.dataTransfer.types;
    if (!types.includes(ASSET_DRAG_TYPE) && !types.includes(TEXT_DRAG_TYPE)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    return true;
  }
  function onDropAsset(e: React.DragEvent, trackId: string) {
    if (!acceptsAsset(e)) return;
    e.stopPropagation();
    const opts = { trackId, at: timeFromClientX(e.clientX) };
    const text = e.dataTransfer.getData(TEXT_DRAG_TYPE);
    if (text) useEditor.getState().addText(JSON.parse(text), opts);
    else addToTimeline(e.dataTransfer.getData(ASSET_DRAG_TYPE), opts);
  }

  const hasClips = timeline.clips.length > 0;

  return (
    <section className="timeline">
      <div className="timeline-toolbar">
        <button className="tool-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="tool-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <div className="toolbar-divider" />
        <button className="tool-btn" onClick={splitAtPlayhead} disabled={!hasClips} title="Split at playhead (Ctrl+B)">
          ✂ Split
        </button>
        <button className="tool-btn" onClick={deleteSelected} disabled={selectedLocked} title="Delete (Del)">
          🗑 Delete
        </button>
        <button className="tool-btn" onClick={duplicateSelected} disabled={selectedLocked} title="Duplicate (Ctrl+D)">
          ⧉ Duplicate
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

          <NewTrackZone label="Drop here to add a new track" onDrop={(e) => onDropAsset(e, 'new')} accepts={acceptsAsset} />

          {timeline.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              // Stable DOM order (by id) so edits never move a clip element mid-drag.
              clips={timeline.clips.filter((c) => c.trackId === track.id).sort((a, b) => (a.id < b.id ? -1 : 1))}
              assets={assets}
              zoom={zoom}
              selectedClipId={selectedClipId}
              drag={drag}
              isDropTarget={!!drag?.moved && drag.trackId === track.id}
              onClipPointerDown={onClipPointerDown}
              onClipPointerMove={onClipPointerMove}
              onClipPointerUp={onClipPointerUp}
              onTrimPointerDown={onTrimPointerDown}
              onDragOver={(e) => !track.locked && acceptsAsset(e)}
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
  onTrimPointerDown: (e: React.PointerEvent, clip: Clip, edge: 'start' | 'end') => void;
  onDragOver: (e: React.DragEvent) => boolean;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { track, zoom, drag } = props;
  const label = track.isMain ? 'Main' : { video: 'Overlay', audio: 'Audio', text: 'Text' }[track.kind];
  const toggle = useEditor((s) => s.toggleTrackFlag);
  const trimHandle = (clip: Clip, edge: 'start' | 'end') => (
    <div
      className={`trim-handle ${edge}`}
      onPointerDown={(e) => props.onTrimPointerDown(e, clip, edge)}
    />
  );
  return (
    <div
      className={`track-row ${track.kind} ${track.isMain ? 'main' : ''} ${track.locked ? 'locked' : ''} ${
        track.hidden ? 'hidden' : ''
      }`}
    >
      <div className="track-header" style={{ width: HEADER_WIDTH }}>
        <span className="track-name">{label}</span>
        <TrackToggle on={track.locked} onClick={() => toggle(track.id, 'locked')} title={track.locked ? 'Unlock track' : 'Lock track'}>
          {track.locked ? '🔒' : '🔓'}
        </TrackToggle>
        {track.kind !== 'audio' && (
          <TrackToggle on={track.hidden} onClick={() => toggle(track.id, 'hidden')} title={track.hidden ? 'Show track' : 'Hide track'}>
            {track.hidden ? '◌' : '◉'}
          </TrackToggle>
        )}
        {track.kind !== 'text' && (
          <TrackToggle on={track.muted} onClick={() => toggle(track.id, 'muted')} title={track.muted ? 'Unmute track' : 'Mute track'}>
            {track.muted ? '🔇' : '🔊'}
          </TrackToggle>
        )}
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
          const selected = props.selectedClipId === clip.id;
          return (
            <div
              key={clip.id}
              className={`clip ${clip.text ? 'text' : (asset?.kind ?? '')} ${selected ? 'selected' : ''} ${
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
                {clip.text ? clip.text.content.split('\n')[0] || 'Text' : asset?.name} · {formatTime(clip.duration)}
              </span>
              {selected && !track.locked && !dragging && (
                <>
                  {trimHandle(clip, 'start')}
                  {trimHandle(clip, 'end')}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrackToggle(props: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      className={`track-toggle ${props.on ? 'on' : ''}`}
      title={props.title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
