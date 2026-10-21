import { create } from 'zustand';

/** The browser's "install this app" prompt, kept until the user asks to install. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const useInstallPrompt = create<{ event: InstallPromptEvent | null }>(() => ({ event: null }));

/** True inside the desktop app, which serves files itself and needs no service worker. */
export const isDesktopApp = location.protocol === 'app:';

/** Register the offline service worker (production web builds only) and catch the install prompt. */
export function setUpPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own Install button instead of the browser's mini-bar
    useInstallPrompt.setState({ event: e as InstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => useInstallPrompt.setState({ event: null }));
  if (import.meta.env.PROD && !isDesktopApp && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('Offline mode unavailable:', e));
  }
}

export async function installApp() {
  const { event } = useInstallPrompt.getState();
  if (!event) return;
  await event.prompt();
  await event.userChoice;
  useInstallPrompt.setState({ event: null });
}
