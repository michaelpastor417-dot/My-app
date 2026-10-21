import { useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { importFile } from '../utils/media';
import { formatTime } from '../utils/time';
import type { MediaAsset } from '../types';

export const ASSET_DRAG_TYPE = 'application/x-clipforge-asset';

const TABS = ['Media', 'Audio', 'Text', 'Stickers', 'Effects', 'Transitions', 'Filters'] as const;

export function MediaPanel() {
  const assets = useEditor((s) => s.assets);
  const addAssets = useEditor((s) => s.addAssets);
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    setImporting((n) => n + list.length);
    const results = await Promise.all(list.map(importFile));
    setImporting((n) => n - list.length);
    const ok = results.filter((a): a is MediaAsset => a !== null);
    addAssets(ok);
    const failed = list.length - ok.length;
    if (failed > 0) setError(`${failed} file${failed > 1 ? 's' : ''} couldn't be imported (unsupported format).`);
  }

  return (
    <aside className="panel media-panel">
      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`tab ${tab === 'Media' ? 'active' : ''}`}
            disabled={tab !== 'Media'}
            title={tab === 'Media' ? undefined : 'Coming in a later step'}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div
        className={`media-body ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <button className="import-btn" onClick={() => inputRef.current?.click()}>
          <span className="import-plus">+</span>
          <span>Import</span>
          <small>or drop video, image & audio files here</small>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {importing > 0 && <div className="media-status">Importing {importing} file(s)…</div>}
        {error && <div className="media-status error">{error}</div>}

        <div className="asset-grid">
          {assets.map((asset) => (
            <AssetTile key={asset.id} asset={asset} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function AssetTile({ asset }: { asset: MediaAsset }) {
  const addToTimeline = useEditor((s) => s.addToTimeline);
  return (
    <div
      className="asset"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={() => addToTimeline(asset.id)}
      title={asset.name}
    >
      <div className="asset-thumb">
        {asset.thumbnail ? (
          <img src={asset.thumbnail} alt="" draggable={false} />
        ) : (
          <div className="asset-audio-icon">♪</div>
        )}
        {asset.kind !== 'image' && <span className="asset-duration">{formatTime(asset.duration)}</span>}
        <button
          className="asset-add"
          title="Add to timeline"
          onClick={(e) => {
            e.stopPropagation();
            addToTimeline(asset.id);
          }}
        >
          +
        </button>
      </div>
      <div className="asset-name">{asset.name}</div>
    </div>
  );
}
