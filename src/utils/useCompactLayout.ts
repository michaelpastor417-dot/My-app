import { useSyncExternalStore } from 'react';

/** Phones and narrow windows get the mobile layout. */
const QUERY = '(max-width: 900px)';

const media = typeof window !== 'undefined' ? window.matchMedia(QUERY) : null;

function subscribe(onChange: () => void) {
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

export function useCompactLayout(): boolean {
  return useSyncExternalStore(subscribe, () => !!media?.matches);
}
