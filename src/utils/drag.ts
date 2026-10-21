/**
 * Follow a pointer drag with window listeners until the pointer is released.
 * Unlike pointer capture this survives React re-rendering or moving the
 * element that started the drag.
 */
export function trackDrag(onMove: (e: PointerEvent) => void, onEnd: () => void) {
  const end = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onEnd();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
