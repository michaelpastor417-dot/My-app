import { type ReactNode, useEffect, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { clipsAt } from '../timeline/model';
import { TopBar } from './TopBar';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { MediaPanel, type Tab } from './MediaPanel';

type Sheet = { kind: 'library'; tab: Tab } | { kind: 'inspector' } | null;

const LIBRARY: { tab: Tab; icon: string }[] = [
  { tab: 'Media', icon: '🎞' },
  { tab: 'Audio', icon: '♪' },
  { tab: 'Text', icon: 'T' },
  { tab: 'Stickers', icon: '☺' },
  { tab: 'Effects', icon: '✦' },
  { tab: 'Filters', icon: '◐' },
  { tab: 'Transitions', icon: '⧓' },
  { tab: 'AI', icon: '✧' },
];

/**
 * The phone layout, after CapCut's mobile app: player on top, timeline below,
 * and a bottom bar that opens libraries and settings as slide-up sheets.
 */
export function MobileEditor() {
  const [sheet, setSheet] = useState<Sheet>(null);
  const selection = useEditor((s) => s.selectedClipId ?? s.selectedTransitionId);

  // Choosing something else closes the settings sheet for the old selection.
  useEffect(() => {
    if (!selection) setSheet((s) => (s?.kind === 'inspector' ? null : s));
  }, [selection]);

  return (
    <div className="app compact">
      <TopBar />
      <Preview />
      <Timeline />
      {selection ? (
        <SelectionBar onEdit={() => setSheet({ kind: 'inspector' })} />
      ) : (
        <nav className="mobile-bar">
          {LIBRARY.map(({ tab, icon }) => (
            <button key={tab} onClick={() => setSheet({ kind: 'library', tab })}>
              <span className="mobile-bar-icon">{icon}</span>
              {tab}
            </button>
          ))}
          <button onClick={() => setSheet({ kind: 'inspector' })}>
            <span className="mobile-bar-icon">▭</span>
            Canvas
          </button>
        </nav>
      )}
      {sheet && (
        <BottomSheet onClose={() => setSheet(null)}>
          {sheet.kind === 'library' ? <MediaPanel initialTab={sheet.tab} /> : <Inspector />}
        </BottomSheet>
      )}
    </div>
  );
}

/** Actions for the selected clip or transition. */
function SelectionBar({ onEdit }: { onEdit: () => void }) {
  const s = useEditor.getState();
  const isClip = useEditor((st) => st.selectedClipId !== null);
  const canFreeze = useEditor((st) => {
    const clip = st.timeline.clips.find((c) => c.id === st.selectedClipId);
    const asset = clip && st.assets.find((a) => a.id === clip.assetId);
    return !!clip && asset?.kind === 'video' && !clip.audioOnly && clip.freezeAt === undefined && clipsAt(st.timeline, st.currentTime).includes(clip);
  });
  const actions: { label: string; icon: string; run: () => void; show?: boolean }[] = [
    { label: 'Edit', icon: '⚙', run: onEdit },
    { label: 'Split', icon: '✂', run: s.splitAtPlayhead, show: isClip },
    { label: 'Freeze', icon: '❄', run: s.freezeFrame, show: canFreeze },
    { label: 'Duplicate', icon: '⧉', run: s.duplicateSelected, show: isClip },
    { label: 'Delete', icon: '🗑', run: s.deleteSelected },
    { label: 'Done', icon: '✓', run: () => s.select(null) },
  ];
  return (
    <nav className="mobile-bar selection">
      {actions
        .filter((a) => a.show !== false)
        .map((a) => (
          <button key={a.label} onClick={a.run}>
            <span className="mobile-bar-icon">{a.icon}</span>
            {a.label}
          </button>
        ))}
    </nav>
  );
}

function BottomSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog">
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <span className="sheet-handle" />
        </button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
