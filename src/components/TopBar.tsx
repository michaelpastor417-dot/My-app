import { useEffect, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { closeProject, saveNow } from '../projects/session';
import { ExportDialog } from './ExportDialog';

const SAVE_LABELS = { saved: 'Saved', saving: 'Saving…', unsaved: 'Edited', error: 'Not saved' } as const;

export function TopBar() {
  const [exporting, setExporting] = useState(false);
  const empty = useEditor((s) => s.timeline.clips.length === 0);
  const saveStatus = useEditor((s) => s.saveStatus);
  return (
    <header className="topbar">
      <button className="home-btn" onClick={() => void closeProject()} title="Save and go back to your projects">
        ‹ <span className="brand-mark">▶</span> Home
      </button>
      <div className="project-name">
        <ProjectName />
        <button
          className={`save-status ${saveStatus}`}
          onClick={() => void saveNow()}
          title={saveStatus === 'error' ? 'Saving failed. Click to try again.' : 'Saved automatically in this browser'}
        >
          {saveStatus === 'saved' ? '✓ ' : ''}
          {SAVE_LABELS[saveStatus]}
        </button>
      </div>
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

/** The project's name, editable in place. */
function ProjectName() {
  const name = useEditor((s) => s.projectName);
  const setProjectName = useEditor((s) => s.setProjectName);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) setProjectName(trimmed);
    else setDraft(name);
  };
  return (
    <input
      className="project-name-input"
      value={draft}
      aria-label="Project name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
