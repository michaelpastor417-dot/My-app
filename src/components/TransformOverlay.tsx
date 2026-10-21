import { useEffect, useRef, useState } from 'react';
import { ASPECT_RATIOS, isClipLocked, useEditor } from '../store/editorStore';
import { clipsAt } from '../timeline/model';
import { angleAround, hitTest, normalizeAngle, rectForClip, snapRotation } from '../engine/geometry';
import { trackDrag } from '../utils/drag';
import { transformAt } from '../timeline/animation';
import { fingerSpan, pinchChange } from '../utils/pinch';
import type { Clip, Timeline } from '../types';

/** id of the Properties panel's text box, focused when text is double-clicked in the player. */
export const TEXT_INPUT_ID = 'text-content-input';

/** Screen distance (px) within which a dragged clip's centre snaps to the canvas centre lines. */
const CENTER_SNAP_PX = 8;
const MIN_SCALE = 0.05;
const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

/** Visual clips under the playhead, topmost first, on tracks that are visible. */
function visibleClipsTopFirst(timeline: Timeline, time: number): Clip[] {
  const active = clipsAt(timeline, time);
  return timeline.tracks
    .filter((t) => t.kind !== 'audio' && !t.hidden)
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
  const overlayRef = useRef<HTMLDivElement>(null);
  usePinchToTransform(overlayRef);

  // Keyframed clips are edited as they appear at the playhead.
  const transformOf = (clip: Clip) => transformAt(clip, currentTime);
  const rectOf = (clip: Clip) => rectForClip(clip, assets, canvasW, canvasH, transformOf(clip));

  const visible = visibleClipsTopFirst(timeline, currentTime);
  const selected = visible.find((c) => c.id === selectedClipId);
  const selectedRect = selected && rectOf(selected);
  const selectedLocked = !!selected && isClipLocked(timeline, selected);

  /** Start a gesture: pause, snapshot for undo, and follow the pointer until release. */
  function gesture(pointerId: number, onMove: (e: PointerEvent) => void, onEnd?: () => void) {
    const store = useEditor.getState();
    store.setPlaying(false);
    store.beginGesture();
    trackDrag(pointerId, onMove, () => {
      onEnd?.();
      useEditor.getState().endGesture();
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Extra fingers belong to the pinch gesture, not a new selection or drag.
    if (e.button !== 0 || !e.isPrimary) return;
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
    const { x: x0, y: y0 } = transformOf(hit);
    const startX = e.clientX;
    const startY = e.clientY;
    const snapX = CENTER_SNAP_PX / displayScale / canvasW;
    const snapY = CENTER_SNAP_PX / displayScale / canvasH;
    gesture(
      e.pointerId,
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
    const scale0 = transformOf(selected).scale;
    gesture(e.pointerId, (ev) => {
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
    const rotation0 = transformOf(selected).rotation;
    setRotating(true);
    gesture(
      e.pointerId,
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
    <div
      ref={overlayRef}
      className="transform-overlay"
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        if (!selected?.text) return;
        const input = document.getElementById(TEXT_INPUT_ID) as HTMLTextAreaElement | null;
        input?.focus();
        input?.select();
      }}
    >
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
                  {Math.round(transformOf(selected).rotation)}°
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Two fingers on the player resize (pinch) and rotate (twist) the selected
 * clip, like CapCut on phones. The whole gesture undoes as one step, together
 * with any move the first finger makes at the same time.
 */
function usePinchToTransform(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current!;
    let pinch: { clipId: string; start: ReturnType<typeof fingerSpan>; scale: number; rotation: number } | null = null;
    const span = (e: TouchEvent) =>
      fingerSpan(
        { x: e.touches[0].clientX, y: e.touches[0].clientY },
        { x: e.touches[1].clientX, y: e.touches[1].clientY },
      );
    const onStart = (e: TouchEvent) => {
      const s = useEditor.getState();
      const clip = s.timeline.clips.find((c) => c.id === s.selectedClipId);
      if (e.touches.length !== 2 || pinch || !clip || isClipLocked(s.timeline, clip)) return;
      const { scale, rotation } = transformAt(clip, s.currentTime);
      s.beginGesture();
      pinch = { clipId: clip.id, start: span(e), scale, rotation };
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      const change = pinchChange(pinch.start, span(e));
      useEditor.getState().updateClipLive(pinch.clipId, {
        transform: {
          scale: Math.max(MIN_SCALE, pinch.scale * change.scale),
          rotation: normalizeAngle(snapRotation(normalizeAngle(pinch.rotation + change.rotation))),
        },
      });
    };
    const onEnd = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return;
      pinch = null;
      useEditor.getState().endGesture();
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ref]);
}
