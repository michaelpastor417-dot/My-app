import { useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { importMedia } from '../projects/session';
import { formatTime } from '../utils/time';
import type { MediaAsset, MediaKind } from '../types';
import { BASE_TEXT } from '../engine/text';
import { STICKERS, TEXT_PRESETS } from '../timeline/textPresets';
import { EffectsLibrary, FiltersLibrary, TransitionsLibrary } from './LookLibraries';
import { AiTools } from './AiTools';

export const ASSET_DRAG_TYPE = 'application/x-clipforge-asset';
/** Drag payload for text presets and stickers: JSON of the `addText` source. */
export const TEXT_DRAG_TYPE = 'application/x-clipforge-text';

const TABS = ['Media', 'Audio', 'Text', 'Stickers', 'Effects', 'Transitions', 'Filters', 'AI'] as const;
export type Tab = (typeof TABS)[number];

export function MediaPanel({ initialTab = 'Media' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <aside className="panel media-panel">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${t === tab ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      {tab === 'Media' && <MediaLibrary kinds={['video', 'image', 'audio']} />}
      {tab === 'Audio' && (
        <MediaLibrary
          kinds={['audio']}
          hint="Music and sound effects you import appear here. Use 🎙 Record on the timeline for voiceovers."
        />
      )}
      {tab === 'Text' && <TextLibrary />}
      {tab === 'Stickers' && <StickerLibrary />}
      {tab === 'Effects' && <EffectsLibrary />}
      {tab === 'Transitions' && <TransitionsLibrary />}
      {tab === 'Filters' && <FiltersLibrary />}
      {tab === 'AI' && <AiTools />}
    </aside>
  );
}

function TextLibrary() {
  const addText = useEditor((s) => s.addText);
  return (
    <div className="media-body">
      <p className="library-hint">Click to add at the playhead, or drag onto the timeline.</p>
      <div className="text-preset-grid">
        {TEXT_PRESETS.map((preset) => {
          const t = { ...BASE_TEXT, ...preset.text };
          return (
            <button
              key={preset.id}
              className="text-preset"
              draggable
              onDragStart={(e) => e.dataTransfer.setData(TEXT_DRAG_TYPE, JSON.stringify({ presetId: preset.id }))}
              onClick={() => addText({ presetId: preset.id })}
              title={`Add "${preset.label}" text`}
            >
              <span
                style={{
                  fontFamily: `"${t.fontFamily}", sans-serif`,
                  fontWeight: t.bold ? 700 : 400,
                  fontStyle: t.italic ? 'italic' : undefined,
                  color: t.color,
                  WebkitTextStroke: t.strokeWidth > 0 ? `1.5px ${t.strokeColor}` : undefined,
                  textShadow: t.shadow ? '0 2px 4px rgba(0,0,0,0.8)' : undefined,
                  background: t.backgroundOpacity > 0 ? t.backgroundColor : undefined,
                  padding: '0 4px',
                  borderRadius: 3,
                }}
              >
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StickerLibrary() {
  const addText = useEditor((s) => s.addText);
  return (
    <div className="media-body">
      <p className="library-hint">Click to add at the playhead, or drag onto the timeline.</p>
      <div className="sticker-grid">
        {STICKERS.map((sticker) => (
          <button
            key={sticker}
            className="sticker"
            draggable
            onDragStart={(e) => e.dataTransfer.setData(TEXT_DRAG_TYPE, JSON.stringify({ sticker }))}
            onClick={() => addText({ sticker })}
          >
            {sticker}
          </button>
        ))}
      </div>
    </div>
  );
}

function MediaLibrary({ kinds, hint }: { kinds: MediaKind[]; hint?: string }) {
  const allAssets = useEditor((s) => s.assets);
  const assets = allAssets.filter((a) => kinds.includes(a.kind));
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    setImporting((n) => n + list.length);
    const { unsupported, noSpace } = await importMedia(list);
    setImporting((n) => n - list.length);
    const problems = [
      unsupported > 0 && `${unsupported} file${unsupported > 1 ? 's' : ''} couldn't be imported (unsupported format).`,
      noSpace > 0 && `${noSpace} file${noSpace > 1 ? 's' : ''} couldn't be saved: the browser's storage is full.`,
    ].filter(Boolean);
    if (problems.length) setError(problems.join(' '));
  }

  return (
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
        <small>or drop {kinds.length === 1 ? 'audio' : 'video, image & audio'} files here</small>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={kinds.map((k) => `${k}/*`).join(',')}
        hidden
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {hint && <p className="library-hint library-hint-below">{hint}</p>}
      {importing > 0 && <div className="media-status">Importing {importing} file(s)…</div>}
      {error && <div className="media-status error">{error}</div>}

      <div className="asset-grid">
        {assets.map((asset) => (
          <AssetTile key={asset.id} asset={asset} />
        ))}
      </div>
    </div>
  );
}

function AssetTile({ asset }: { asset: MediaAsset }) {
  const addToTimeline = useEditor((s) => s.addToTimeline);
  return (
    <div
      className={`asset ${asset.missing ? 'missing' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={() => addToTimeline(asset.id)}
      title={asset.missing ? `${asset.name}: the file is no longer in this browser's storage` : asset.name}
    >
      <div className="asset-thumb">
        {asset.missing && <span className="asset-missing">Missing</span>}
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
