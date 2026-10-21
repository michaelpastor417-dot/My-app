import { ASPECT_RATIOS, isClipLocked, useEditor } from '../store/editorStore';
import { DEFAULT_TRANSFORM, NO_CROP } from '../engine/geometry';
import { formatTime } from '../utils/time';
import type { CanvasBackground, Clip, ClipAudio, Crop, MediaAsset, TextAnimationIn, TextAnimationOut, TextData } from '../types';
import { FONT_FAMILIES } from '../engine/text';
import { MAX_VOLUME } from '../engine/audio';
import { TEXT_INPUT_ID } from './TransformOverlay';

type TextProps = { clip: Clip; text: TextData };

const ANIMATIONS_IN: Record<TextAnimationIn, string> = {
  none: 'None',
  fade: 'Fade in',
  'slide-up': 'Slide up',
  pop: 'Pop',
  typewriter: 'Typewriter',
};
const ANIMATIONS_OUT: Record<TextAnimationOut, string> = {
  none: 'None',
  fade: 'Fade out',
  'slide-down': 'Slide down',
  pop: 'Pop',
};

function useTextUpdater(clip: Clip) {
  const updateText = useEditor((s) => s.updateText);
  return (key: string, patch: Partial<TextData>) => updateText(clip.id, patch, key);
}

function TextSection({ clip, text }: TextProps) {
  const set = useTextUpdater(clip);
  return (
    <section className="inspector-section">
      <textarea
        id={TEXT_INPUT_ID}
        className="text-input"
        rows={3}
        value={text.content}
        placeholder="Enter text"
        onChange={(e) => set('content', { content: e.target.value })}
      />
      <label className="field select-field">
        <span>Font</span>
        <select value={text.fontFamily} onChange={(e) => set('font', { fontFamily: e.target.value })}>
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <SliderField
        label="Size"
        unit=""
        min={8}
        max={400}
        value={Math.round(text.fontSize)}
        onChange={(v) => set('size', { fontSize: v })}
      />
      <div className="text-format-row">
        <input
          type="color"
          title="Text colour"
          value={text.color}
          onChange={(e) => set('color', { color: e.target.value })}
        />
        <div className="segmented">
          <button className={text.bold ? 'active' : ''} onClick={() => set('bold', { bold: !text.bold })} title="Bold">
            <b>B</b>
          </button>
          <button
            className={text.italic ? 'active' : ''}
            onClick={() => set('italic', { italic: !text.italic })}
            title="Italic"
          >
            <i>I</i>
          </button>
        </div>
        <div className="segmented">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              className={text.align === align ? 'active' : ''}
              onClick={() => set('align', { align })}
              title={`Align ${align}`}
            >
              {{ left: '⇤', center: '≡', right: '⇥' }[align]}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function TextStyleSection({ clip, text }: TextProps) {
  const set = useTextUpdater(clip);
  return (
    <section className="inspector-section">
      <header>
        <h4>Style</h4>
      </header>
      <div className="color-slider-row">
        <input
          type="color"
          title="Outline colour"
          value={text.strokeColor}
          onChange={(e) => set('stroke-color', { strokeColor: e.target.value })}
        />
        <SliderField
          label="Outline"
          unit="%"
          min={0}
          max={30}
          value={Math.round(text.strokeWidth * 100)}
          onChange={(v) => set('stroke', { strokeWidth: v / 100 })}
        />
      </div>
      <div className="color-slider-row">
        <input
          type="color"
          title="Background colour"
          value={text.backgroundColor}
          onChange={(e) => set('bg-color', { backgroundColor: e.target.value })}
        />
        <SliderField
          label="Box"
          unit="%"
          min={0}
          max={100}
          value={Math.round(text.backgroundOpacity * 100)}
          onChange={(v) => set('bg', { backgroundOpacity: v / 100 })}
        />
      </div>
      <label className="checkbox-field">
        <input type="checkbox" checked={text.shadow} onChange={(e) => set('shadow', { shadow: e.target.checked })} />
        Shadow
      </label>
    </section>
  );
}

function AnimationSection({ clip, text }: TextProps) {
  const set = useTextUpdater(clip);
  return (
    <section className="inspector-section">
      <header>
        <h4>Animation</h4>
      </header>
      <label className="field select-field">
        <span>In</span>
        <select
          value={text.animationIn}
          onChange={(e) => set('anim-in', { animationIn: e.target.value as TextAnimationIn })}
        >
          {Object.entries(ANIMATIONS_IN).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field select-field">
        <span>Out</span>
        <select
          value={text.animationOut}
          onChange={(e) => set('anim-out', { animationOut: e.target.value as TextAnimationOut })}
        >
          {Object.entries(ANIMATIONS_OUT).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

export function Inspector() {
  const clip = useEditor((s) => s.timeline.clips.find((c) => c.id === s.selectedClipId));
  const asset = useEditor((s) => (clip ? s.assets.find((a) => a.id === clip.assetId) : undefined));
  const track = useEditor((s) => (clip ? s.timeline.tracks.find((t) => t.id === clip.trackId) : undefined));
  const locked = useEditor((s) => !!clip && isClipLocked(s.timeline, clip));

  return (
    <aside className="panel inspector">
      <div className="panel-title">{clip ? (clip.text ? 'Text' : 'Clip') : 'Canvas'}</div>
      <div className="inspector-body">
        {!clip ? (
          <CanvasSettings />
        ) : clip.text ? (
          <>
            <dl className="props">
              <dt>Start</dt>
              <dd>{formatTime(clip.start, true)}</dd>
              <dt>Duration</dt>
              <dd>{formatTime(clip.duration, true)}</dd>
            </dl>
            {locked && <p className="empty-hint">This clip's track is locked.</p>}
            <fieldset disabled={locked}>
              <TextSection clip={clip} text={clip.text} />
              <TextStyleSection clip={clip} text={clip.text} />
              <AnimationSection clip={clip} text={clip.text} />
              <TransformSection clip={clip} />
            </fieldset>
          </>
        ) : !asset ? null : (
          <>
            <dl className="props">
              <dt>Name</dt>
              <dd title={asset.name}>{asset.name}</dd>
              <dt>Track</dt>
              <dd>{track?.isMain ? 'Main track' : track?.kind === 'audio' ? 'Audio track' : 'Overlay'}</dd>
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
            <fieldset disabled={locked}>
              <AudioSection clip={clip} asset={asset} />
              {asset.kind !== 'audio' && !clip.audioOnly && (
                <>
                  <TransformSection clip={clip} />
                  <CropSection clip={clip} />
                </>
              )}
            </fieldset>
          </>
        )}
      </div>
    </aside>
  );
}

/** Rounds to one decimal place for display in the fade fields. */
const tenths = (v: number) => Math.round(v * 10) / 10;

function AudioSection({ clip, asset }: { clip: Clip; asset: MediaAsset }) {
  const updateClip = useEditor((s) => s.updateClip);
  const detachAudio = useEditor((s) => s.detachAudio);
  if (asset.kind === 'image') return null;
  const decoding = asset.peaks === undefined;
  const silent = asset.peaks?.length === 0;
  const set = (key: string, audio: Partial<ClipAudio>) => updateClip(clip.id, { audio }, key);
  const maxFade = tenths(Math.min(10, clip.duration));

  return (
    <section className="inspector-section">
      <header>
        <h4>Audio</h4>
        {asset.kind === 'video' && !clip.audioOnly && !clip.audioDetached && !silent && (
          <button className="link-btn" onClick={() => detachAudio(clip.id)} disabled={decoding}>
            Detach audio
          </button>
        )}
      </header>
      {clip.audioDetached ? (
        <p className="section-note">The sound plays from its own clip on an audio track.</p>
      ) : silent ? (
        <p className="section-note">This clip has no sound.</p>
      ) : (
        <>
          <SliderField
            label="Volume"
            unit="%"
            min={0}
            max={MAX_VOLUME * 100}
            value={Math.round(clip.audio.volume * 100)}
            onChange={(v) => set('volume', { volume: v / 100 })}
          />
          <SliderField
            label="Fade in"
            unit="s"
            min={0}
            max={maxFade}
            step={0.1}
            value={tenths(clip.audio.fadeIn)}
            onChange={(v) => set('fade-in', { fadeIn: v })}
          />
          <SliderField
            label="Fade out"
            unit="s"
            min={0}
            max={maxFade}
            step={0.1}
            value={tenths(clip.audio.fadeOut)}
            onChange={(v) => set('fade-out', { fadeOut: v })}
          />
        </>
      )}
    </section>
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
  step?: number;
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
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="field-value">
        <input
          type="number"
          step={props.step}
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
