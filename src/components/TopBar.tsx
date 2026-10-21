export function TopBar() {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">▶</span> ClipForge
      </div>
      <div className="project-name">Untitled project</div>
      <button className="btn btn-primary" disabled title="Export arrives in a later step">
        Export
      </button>
    </header>
  );
}
