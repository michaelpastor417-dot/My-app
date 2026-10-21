import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { MediaPanel } from './components/MediaPanel';
import { Preview } from './components/Preview';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { useEditor } from './store/editorStore';

const FRAME = 1 / 30;

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const s = useEditor.getState();
      if (e.ctrlKey || e.metaKey) {
        const handled = {
          z: () => (e.shiftKey ? s.redo() : s.undo()),
          y: s.redo,
          b: s.splitAtPlayhead,
          d: s.duplicateSelected,
          c: s.copySelected,
          v: s.paste,
        }[e.key.toLowerCase()];
        if (handled) {
          e.preventDefault();
          handled();
        }
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          s.togglePlay();
          break;
        case 'Delete':
        case 'Backspace':
          s.deleteSelected();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          s.seek(s.currentTime - (e.shiftKey ? 1 : FRAME));
          break;
        case 'ArrowRight':
          e.preventDefault();
          s.seek(s.currentTime + (e.shiftKey ? 1 : FRAME));
          break;
        case 'Escape':
          s.select(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useKeyboardShortcuts();
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <MediaPanel />
        <Preview />
        <Inspector />
      </div>
      <Timeline />
    </div>
  );
}
