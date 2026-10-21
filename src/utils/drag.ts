/**
 * Follow one pointer (mouse, pen or finger `pointerId`) with window listeners
 * until it's released. Unlike pointer capture this survives React re-rendering
 * or moving the element that started the drag, and other fingers are ignored.
 */
export function trackDrag(pointerId: number, onMove: (e: PointerEvent) => void, onEnd: () => void) {
  const move = (e: PointerEvent) => {
    if (e.pointerId === pointerId) onMove(e);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onEnd();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
