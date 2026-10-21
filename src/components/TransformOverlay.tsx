import { useState } from 'react';
import { ASPECT_RATIOS, isClipLocked, useEditor } from '../store/editorStore';
import { clipsAt } from '../timeline/model';
import { angleAround, clipRect, hitTest, normalizeAngle, snapRotation } from '../engine/geometry';
import { trackDrag } from '../utils/drag';
import type { Clip, MediaAsset, Timeline } from '../types';

/** Screen distance (px) within which a dragged clip's centre snaps to the canvas centre lines. */
const CENTER_SNAP_PX = 8;
const MIN_SCALE = 0.05;
const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

/** Visual clips under the playhead, topmost first, on tracks that are visible. */
function visibleClipsTopFirst(timeline: Timeline, time: number): Clip[] {
  const active = clipsAt(timeline, time);
  return timeline.tracks
    .filter((t) => t.kind === 'video' && !t.hidden)
    .flatMap((t) => active.filter((c) => c.trackId === t.id));
}

/**
 * Sits on top of the preview canvas. Clicking selects the topmost clip under
 * the pointer; the selected clip gets a box with handles to move, scale
 * (corners) and rotate (top knob), like CapCut's player.
 *
 * `displayScale` is screen pixels per canvas pixel.
 */
export function TransformOverlay({ displayScale }: { displayScale: number }) {
  const timeline = useEditor((s) => s.timeline);
  const assets = useEditor((s) => s.assets);
  const currentTime = useEditor((s) => s.currentTime);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const aspectRatio = useEditor((s) => s.aspectRatio);
  const [canvasW, canvasH] = ASPECT_RATIOS[aspectRatio];
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const [rotating, setRotating] = useState(false);

  const assetOf = (clip: Clip): MediaAsset | undefined => assets.find((a) => a.id === clip.assetId);
  const rectOf = (clip: Clip) => {
    const asset = assetOf(clip);
    return asset ? clipRect(asset, clip.transform, clip.crop, canvasW, canvasH) : null;
  };

  const visible = visibleClipsTopFirst(timeline, currentTime);
  const selected = visible.find((c) => c.id === selectedClipId);
  const selectedRect = selected && rectOf(selected);
  const selectedLocked = !!selected && isClipLocked(timeline, selected);

  /** Start a gesture: pause, snapshot for undo, and follow the pointer until release. */
  function gesture(onMove: (e: PointerEvent) => void, onEnd?: () => void) {
    const store = useEditor.getState();
    store.setPlaying(false);
    store.beginGesture();
    trackDrag(onMove, () => {
      onEnd?.();
      useEditor.getState().endGesture();
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - box.left) / displayScale;
    const py = (e.clientY - box.top) / displayScale;
    const hit = visible.find((c) => {
      const r = rectOf(c);
      return r && hitTest(r, px, py);
    });
    const store = useEditor.getState();
    if (!hit) {
      store.select(null);
      return;
    }
    if (isClipLocked(timeline, hit)) {
      store.select(null);
      return;
    }
    store.select(hit.id);

    // Move: drag the clip, snapping its centre to the canvas centre lines.
    const { x: x0, y: y0 } = hit.transform;
    const startX = e.clientX;
    const startY = e.clientY;
    const snapX = CENTER_SNAP_PX / displayScale / canvasW;
    const snapY = CENTER_SNAP_PX / displayScale / canvasH;
    gesture(
      (ev) => {
        let x = x0 + (ev.clientX - startX) / displayScale / canvasW;
        let y = y0 + (ev.clientY - startY) / displayScale / canvasH;
        const v = Math.abs(x) < snapX;
        const h = Math.abs(y) < snapY;
        if (v) x = 0;
        if (h) y = 0;
        setGuides({ v, h });
        useEditor.getState().updateClipLive(hit.id, { transform: { x, y } });
      },
      () => setGuides({ v: false, h: false }),
    );
  }

  function onScalePointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !selected || !selectedRect) return;
    e.stopPropagation();
    const center = canvasToClient(e.currentTarget, selectedRect.cx, selectedRect.cy);
    const startDist = Math.hypot(e.clientX - center.x, e.clientY - center.y) || 1;
    const scale0 = selected.transform.scale;
    gesture((ev) => {
      const dist = Math.hypot(ev.clientX - center.x, ev.clientY - center.y);
      const scale = Math.max(MIN_SCALE, (scale0 * dist) / startDist);
      useEditor.getState().updateClipLive(selected.id, { transform: { scale } });
    });
  }

  function onRotatePointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !selected || !selectedRect) return;
    e.stopPropagation();
    const center = canvasToClient(e.currentTarget, selectedRect.cx, selectedRect.cy);
    const angle0 = angleAround(center.x, center.y, e.clientX, e.clientY);
    const rotation0 = selected.transform.rotation;
    setRotating(true);
    gesture(
      (ev) => {
        const angle = angleAround(center.x, center.y, ev.clientX, ev.clientY);
        const rotation = normalizeAngle(snapRotation(normalizeAngle(rotation0 + angle - angle0)));
        useEditor.getState().updateClipLive(selected.id, { transform: { rotation } });
      },
      () => setRotating(false),
    );
  }

  /** Convert a canvas point to client coordinates via the overlay's on-screen position. */
  function canvasToClient(handle: Element, cx: number, cy: number) {
    const overlay = handle.closest('.transform-overlay')!.getBoundingClientRect();
    return { x: overlay.left + cx * displayScale, y: overlay.top + cy * displayScale };
  }

  return (
    <div className="transform-overlay" onPointerDown={onPointerDown}>
      {guides.v && <div className="snap-guide vertical" />}
      {guides.h && <div className="snap-guide horizontal" />}
      {selected && selectedRect && (
        <div
          className={`selection-box ${selectedLocked ? 'locked' : ''}`}
          style={{
            left: (selectedRect.cx - selectedRect.w / 2) * displayScale,
            top: (selectedRect.cy - selectedRect.h / 2) * displayScale,
            width: selectedRect.w * displayScale,
            height: selectedRect.h * displayScale,
            transform: `rotate(${selectedRect.rotation}deg)`,
          }}
        >
          {!selectedLocked && (
            <>
              {CORNERS.map((corner) => (
                <div key={corner} className={`scale-handle ${corner}`} onPointerDown={onScalePointerDown} />
              ))}
              <div className="rotate-handle" onPointerDown={onRotatePointerDown} title="Rotate">
                ⟳
              </div>
              {rotating && (
                <div className="rotation-badge" style={{ transform: `rotate(${-selectedRect.rotation}deg)` }}>
                  {Math.round(selected.transform.rotation)}°
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
