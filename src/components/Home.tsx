import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../projects/document';
import { deleteProject, duplicateProject, listProjects, renameProject } from '../projects/repository';
import { createProject, openProject } from '../projects/session';
import { formatTime, timeAgo } from '../utils/time';
import { installApp, useInstallPrompt } from '../pwa';

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function InstallButton() {
  const canInstall = useInstallPrompt((s) => s.event !== null);
  if (!canInstall) return null;
  return (
    <button className="btn install-btn" onClick={() => void installApp()} title="Install ClipForge as an app on this device">
      ⤓ Install app
    </button>
  );
}

/** The start screen: new project, and every saved draft (like CapCut's home). */
export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setProjects(await listProjects());
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota) setStorage({ usage: estimate.usage ?? 0, quota: estimate.quota });
    } catch (e) {
      setError(`Saved projects couldn't be read (${(e as Error).message}).`);
      setProjects([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function open(id: string) {
    try {
      if (!(await openProject(id))) {
        setError('That project no longer exists.');
        void refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">▶</span> ClipForge
        </div>
        <InstallButton />
        {storage && (
          <span className="home-storage" title="Space this browser lets ClipForge use">
            {formatBytes(storage.usage)} of {formatBytes(storage.quota)} used
          </span>
        )}
      </header>
      <main className="home-main">
        <button className="new-project" onClick={() => void createProject()}>
          <span className="new-project-plus">+</span>
          New project
        </button>
        {error && <p className="home-error">{error}</p>}
        <h2 className="home-heading">Projects</h2>
        {projects === null ? (
          <p className="home-empty">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="home-empty">No projects yet. Start one above; it's saved automatically as you edit.</p>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onOpen={() => void open(p.id)} onChanged={refresh} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard(props: { project: ProjectSummary; onOpen: () => void; onChanged: () => Promise<void> }) {
  const { project } = props;
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(project.name);

  async function commitRename() {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) {
      await renameProject(project.id, trimmed);
      await props.onChanged();
    } else {
      setName(project.name);
    }
  }

  return (
    <div className="project-card">
      <button className="project-thumb" onClick={props.onOpen} title={`Open ${project.name}`}>
        {project.thumbnail ? <img src={project.thumbnail} alt="" /> : <span>No preview</span>}
        <span className="project-duration">{formatTime(project.duration)}</span>
      </button>
      <div className="project-info">
        {renaming ? (
          <input
            className="text-field"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename();
              if (e.key === 'Escape') {
                setName(project.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <div className="project-name-row">
            <span className="project-title" title={project.name}>
              {project.name}
            </span>
            <button className="project-menu-btn" onClick={() => setMenu(!menu)} title="More">
              ⋯
            </button>
          </div>
        )}
        <span className="project-meta">
          {project.aspectRatio} · edited {timeAgo(project.updatedAt)}
        </span>
      </div>
      {menu && (
        <div className="project-menu" onMouseLeave={() => setMenu(false)}>
          <button onClick={() => (setMenu(false), setRenaming(true))}>Rename</button>
          <button
            onClick={async () => {
              setMenu(false);
              await duplicateProject(project.id);
              await props.onChanged();
            }}
          >
            Duplicate
          </button>
          <button className="danger" onClick={() => (setMenu(false), setConfirmDelete(true))}>
            Delete
          </button>
        </div>
      )}
      {confirmDelete && (
        <div className="project-confirm">
          <span>Delete “{project.name}”? This can't be undone.</span>
          <div>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await deleteProject(project.id);
                await props.onChanged();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
