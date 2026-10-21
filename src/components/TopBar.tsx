import { useState } from 'react';
import { useEditor } from '../store/editorStore';
import { ExportDialog } from './ExportDialog';

export function TopBar() {
  const [exporting, setExporting] = useState(false);
  const empty = useEditor((s) => s.timeline.clips.length === 0);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">▶</span> ClipForge
      </div>
      <div className="project-name">Untitled project</div>
      <button
        className="btn btn-primary"
        disabled={empty}
        onClick={() => setExporting(true)}
        title={empty ? 'Add something to the timeline first' : 'Export to MP4'}
      >
        Export
      </button>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </header>
  );
}
