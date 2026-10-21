import { useEffect, useState } from 'react';
import { lookTargetOf, useEditor } from '../store/editorStore';
import { EFFECTS, FILTERS, resolveLook } from '../timeline/look';
import { TRANSITIONS } from '../timeline/transitions';
import { getGpu } from '../engine/gpu';
import type { FilterId } from '../types';

/** The clip a library click will change, for the "Applies to" line. */
function useLookTarget() {
  return useEditor((s) => lookTargetOf(s));
}

function TargetLine({ name }: { name?: string }) {
  return (
    <p className="library-hint">
      {name ? (
        <>
          Applies to <strong>{name}</strong>
        </>
      ) : (
        'Select a video or image clip, or move the playhead over the main track.'
      )}
    </p>
  );
}

let sampleImage: string | null = null;

/** A colourful stand-in picture for filter previews when there's no clip to preview with. */
function sample(): string {
  if (sampleImage) return sampleImage;
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 100;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 100);
  sky.addColorStop(0, '#3a7bd5');
  sky.addColorStop(0.6, '#f6b26b');
  sky.addColorStop(1, '#6aa84f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 160, 100);
  ctx.fillStyle = '#ffd966';
  ctx.beginPath();
  ctx.arc(110, 45, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#274e13';
  ctx.fillRect(0, 75, 160, 25);
  ctx.fillStyle = '#cc4125';
  ctx.fillRect(25, 55, 30, 25);
  sampleImage = canvas.toDataURL();
  return sampleImage;
}

const previewCache = new Map<string, string>();

/** Render a thumbnail through the real GPU filter, so the preview matches the result exactly. */
async function filterPreview(imageUrl: string, id: FilterId): Promise<string> {
  const key = `${id}|${imageUrl}`;
  const cached = previewCache.get(key);
  if (cached) return cached;
  const gpu = getGpu();
  const look = resolveLook({ filter: { id, intensity: 1 } });
  if (!gpu || !look) return imageUrl;
  const img = new Image();
  img.src = imageUrl;
  await img.decode();
  const { naturalWidth: w, naturalHeight: h } = img;
  gpu.processClip(img, w, h, { sx: 0, sy: 0, sw: w, sh: h }, look, 0, w, h);
  const url = gpu.canvas.toDataURL('image/jpeg', 0.85);
  previewCache.set(key, url);
  return url;
}

function FilterThumb({ imageUrl, id }: { imageUrl: string; id: FilterId }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    filterPreview(imageUrl, id).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [imageUrl, id]);
  return url ? <img src={url} alt="" draggable={false} /> : <div className="look-thumb-placeholder" />;
}

export function FiltersLibrary() {
  const target = useLookTarget();
  const thumbnail = useEditor((s) => s.assets.find((a) => a.id === target?.assetId)?.thumbnail);
  const applyFilter = useEditor((s) => s.applyFilter);
  const setFilter = useEditor((s) => s.setFilter);
  const imageUrl = thumbnail ?? sample();
  const active = target?.filter?.id;

  return (
    <div className="media-body">
      <TargetLine name={useTargetName(target?.assetId)} />
      <div className="look-grid">
        <button
          className={`look-tile ${!active ? 'active' : ''}`}
          disabled={!target}
          onClick={() => target && setFilter(target.id, null)}
        >
          <div className="look-thumb">
            <img src={imageUrl} alt="" draggable={false} />
          </div>
          <span>None</span>
        </button>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`look-tile ${active === f.id ? 'active' : ''}`}
            disabled={!target}
            onClick={() => applyFilter(f.id)}
          >
            <div className="look-thumb">
              <FilterThumb imageUrl={imageUrl} id={f.id} />
            </div>
            <span>{f.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function useTargetName(assetId?: string) {
  return useEditor((s) => s.assets.find((a) => a.id === assetId)?.name);
}

export function EffectsLibrary() {
  const target = useLookTarget();
  const applyEffect = useEditor((s) => s.applyEffect);
  const setEffect = useEditor((s) => s.setEffect);
  const active = target?.effect?.id;
  return (
    <div className="media-body">
      <TargetLine name={useTargetName(target?.assetId)} />
      <div className="look-grid">
        <button
          className={`look-tile icon-tile ${!active ? 'active' : ''}`}
          disabled={!target}
          onClick={() => target && setEffect(target.id, null)}
        >
          <div className="look-icon">∅</div>
          <span>None</span>
        </button>
        {EFFECTS.map((e) => (
          <button
            key={e.id}
            className={`look-tile icon-tile ${active === e.id ? 'active' : ''}`}
            disabled={!target}
            onClick={() => applyEffect(e.id)}
          >
            <div className="look-icon">{e.icon}</div>
            <span>{e.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TransitionsLibrary() {
  const applyTransition = useEditor((s) => s.applyTransition);
  const hasCut = useEditor((s) => s.timeline.clips.filter((c) => c.trackId === 'main').length > 1);
  const selectedType = useEditor(
    (s) => s.timeline.clips.find((c) => c.id === s.selectedTransitionId)?.transition?.type,
  );
  return (
    <div className="media-body">
      <p className="library-hint">
        {hasCut
          ? 'Applies to the selected cut (click ⧓ between clips), or the cut nearest the playhead.'
          : 'Put two or more clips on the main track to add transitions between them.'}
      </p>
      <div className="look-grid">
        {TRANSITIONS.map((t) => (
          <button
            key={t.type}
            className={`look-tile icon-tile ${selectedType === t.type ? 'active' : ''}`}
            disabled={!hasCut}
            onClick={() => applyTransition(t.type)}
          >
            <div className="look-icon">{t.icon}</div>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
