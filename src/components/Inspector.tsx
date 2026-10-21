import { ASPECT_RATIOS, isClipLocked, useEditor } from '../store/editorStore';
import { DEFAULT_TRANSFORM, NO_CROP } from '../engine/geometry';
import { formatTime } from '../utils/time';
import type { CanvasBackground, Clip, Crop } from '../types';

export function Inspector() {
  const clip = useEditor((s) => s.timeline.clips.find((c) => c.id === s.selectedClipId));
  const asset = useEditor((s) => (clip ? s.assets.find((a) => a.id === clip.assetId) : undefined));
  const track = useEditor((s) => (clip ? s.timeline.tracks.find((t) => t.id === clip.trackId) : undefined));
  const locked = useEditor((s) => !!clip && isClipLocked(s.timeline, clip));

  return (
    <aside className="panel inspector">
      <div className="panel-title">{clip ? 'Clip' : 'Canvas'}</div>
      <div className="inspector-body">
        {!clip || !asset ? (
          <CanvasSettings />
        ) : (
          <>
            <dl className="props">
              <dt>Name</dt>
              <dd title={asset.name}>{asset.name}</dd>
              <dt>Track</dt>
              <dd>{track?.isMain ? 'Main track' : `${track?.kind} overlay`}</dd>
              <dt>Start</dt>
              <dd>{formatTime(clip.start, true)}</dd>
              <dt>Duration</dt>
              <dd>{formatTime(clip.duration, true)}</dd>
              {asset.width && (
                <>
                  <dt>Source</dt>
                  <dd>
                    {asset.width}×{asset.height}
                  </dd>
                </>
              )}
            </dl>
            {locked && <p className="empty-hint">This clip's track is locked.</p>}
            {asset.kind !== 'audio' && (
              <fieldset disabled={locked}>
                <TransformSection clip={clip} />
                <CropSection clip={clip} />
              </fieldset>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function TransformSection({ clip }: { clip: Clip }) {
  const updateClip = useEditor((s) => s.updateClip);
  const [canvasW, canvasH] = useEditor((s) => ASPECT_RATIOS[s.aspectRatio]);
  const t = clip.transform;
  const set = (key: string, transform: Partial<Clip['transform']>) => updateClip(clip.id, { transform }, key);

  return (
    <section className="inspector-section">
      <header>
        <h4>Transform</h4>
        <button className="link-btn" onClick={() => updateClip(clip.id, { transform: DEFAULT_TRANSFORM })}>
          Reset
        </button>
      </header>
      <SliderField
        label="Scale"
        unit="%"
        min={5}
        max={400}
        value={Math.round(t.scale * 100)}
        onChange={(v) => set('scale', { scale: v / 100 })}
      />
      <div className="field-row">
        <NumberField
          label="X"
          value={Math.round(t.x * canvasW)}
          onChange={(v) => set('x', { x: v / canvasW })}
        />
        <NumberField
          label="Y"
          value={Math.round(t.y * canvasH)}
          onChange={(v) => set('y', { y: v / canvasH })}
        />
      </div>
      <SliderField
        label="Rotate"
        unit="°"
        min={-180}
        max={180}
        value={Math.round(t.rotation)}
        onChange={(v) => set('rotation', { rotation: v })}
      />
      <SliderField
        label="Opacity"
        unit="%"
        min={0}
        max={100}
        value={Math.round(t.opacity * 100)}
        onChange={(v) => set('opacity', { opacity: v / 100 })}
      />
    </section>
  );
}

function CropSection({ clip }: { clip: Clip }) {
  const updateClip = useEditor((s) => s.updateClip);
  const sides: (keyof Crop)[] = ['left', 'right', 'top', 'bottom'];
  return (
    <section className="inspector-section">
      <header>
        <h4>Crop</h4>
        <button className="link-btn" onClick={() => updateClip(clip.id, { crop: NO_CROP })}>
          Reset
        </button>
      </header>
      {sides.map((side) => (
        <SliderField
          key={side}
          label={side[0].toUpperCase() + side.slice(1)}
          unit="%"
          min={0}
          max={95}
          value={Math.round(clip.crop[side] * 100)}
          onChange={(v) => updateClip(clip.id, { crop: { [side]: v / 100 } }, `crop-${side}`)}
        />
      ))}
    </section>
  );
}

function CanvasSettings() {
  const background = useEditor((s) => s.timeline.background);
  const setBackground = useEditor((s) => s.setBackground);
  const aspectRatio = useEditor((s) => s.aspectRatio);
  const [w, h] = ASPECT_RATIOS[aspectRatio];
  const choose = (type: CanvasBackground['type']) =>
    setBackground(type === 'color' ? { type, color: '#000000' } : { type, amount: 0.5 });

  return (
    <>
      <dl className="props">
        <dt>Ratio</dt>
        <dd>{aspectRatio}</dd>
        <dt>Size</dt>
        <dd>
          {w}×{h}
        </dd>
      </dl>
      <section className="inspector-section">
        <header>
          <h4>Background</h4>
        </header>
        <div className="segmented">
          <button className={background.type === 'color' ? 'active' : ''} onClick={() => choose('color')}>
            Color
          </button>
          <button className={background.type === 'blur' ? 'active' : ''} onClick={() => choose('blur')}>
            Blur
          </button>
        </div>
        {background.type === 'color' ? (
          <label className="field">
            <span>Color</span>
            <input
              type="color"
              value={background.color}
              onChange={(e) => setBackground({ type: 'color', color: e.target.value }, 'color')}
            />
          </label>
        ) : (
          <SliderField
            label="Blur"
            unit="%"
            min={5}
            max={100}
            value={Math.round(background.amount * 100)}
            onChange={(v) => setBackground({ type: 'blur', amount: v / 100 }, 'blur')}
          />
        )}
      </section>
      <p className="empty-hint">Select a clip on the timeline or in the player to edit it.</p>
    </>
  );
}

function SliderField(props: {
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field slider-field">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="field-value">
        <input
          type="number"
          value={props.value}
          onChange={(e) => e.target.value !== '' && props.onChange(Number(e.target.value))}
        />
        {props.unit}
      </span>
    </label>
  );
}

function NumberField(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field number-field">
      <span>{props.label}</span>
      <input
        type="number"
        value={props.value}
        onChange={(e) => e.target.value !== '' && props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
