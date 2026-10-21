import { useState } from 'react';
import { type EditorState, lookTargetOf, useEditor } from '../store/editorStore';
import { clipsAt } from '../timeline/model';
import { DEFAULT_SILENCE } from '../ai/silence';
import { LANGUAGES, SPEECH_MODELS, type TranscribeProgress, transcribeClip } from '../ai/transcribe';
import { useSegmenterStatus } from '../ai/segmenter';
import type { Clip } from '../types';

/** The clip a sound tool acts on: the selected clip with sound, else the main clip at the playhead, else any audio there. */
function soundTargetOf(s: EditorState): Clip | undefined {
  const hasSound = (c: Clip) => {
    const asset = s.assets.find((a) => a.id === c.assetId);
    return !!asset && asset.kind !== 'image' && !c.text && c.freezeAt === undefined && !c.audioDetached;
  };
  const selected = s.timeline.clips.find((c) => c.id === s.selectedClipId);
  if (selected && hasSound(selected)) return selected;
  const under = clipsAt(s.timeline, s.currentTime).filter(hasSound);
  return under.find((c) => c.trackId === 'main') ?? under[0];
}

function useClipName(clip?: Clip) {
  return useEditor((s) => s.assets.find((a) => a.id === clip?.assetId)?.name);
}

function Target({ name, missing }: { name?: string; missing: string }) {
  return <p className="ai-target">{name ? <>On <strong>{name}</strong></> : missing}</p>;
}

export function AiTools() {
  return (
    <div className="media-body ai-tools">
      <p className="library-hint">These run on this device. Your media never leaves your computer.</p>
      <CaptionsTool />
      <SilenceTool />
      <BackgroundTool />
    </div>
  );
}

const PROGRESS_TEXT: Record<TranscribeProgress['stage'], string> = {
  preparing: 'Reading the audio…',
  downloading: 'Downloading the speech model (first time only)…',
  loading: 'Starting the speech model…',
  listening: 'Listening and writing captions…',
};

function CaptionsTool() {
  const target = useEditor(soundTargetOf);
  const name = useClipName(target);
  const [language, setLanguage] = useState('');
  const [model, setModel] = useState<string>(SPEECH_MODELS[0].id);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function run() {
    const s = useEditor.getState();
    const asset = s.assets.find((a) => a.id === target?.assetId);
    if (!target || !asset) return;
    if (target.reversed) {
      setMessage({ text: "Captions can't be made for a reversed clip.", error: true });
      return;
    }
    setMessage(null);
    try {
      const chunks = await transcribeClip(target, asset, { model, language: language || null }, setProgress);
      const added = useEditor.getState().addCaptions(target.id, chunks);
      setMessage({ text: added ? `Added ${added} caption${added > 1 ? 's' : ''} on a new text track.` : 'No speech was found.' });
    } catch (error) {
      setMessage({ text: `Couldn't make captions: ${(error as Error).message}`, error: true });
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className="ai-card">
      <h4>Auto captions</h4>
      <p className="section-note">Turns speech into timed subtitles you can edit like any text.</p>
      <Target name={name} missing="Select a clip with speech, or move the playhead over one." />
      <label className="field select-field">
        <span>Language</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!progress}>
          {LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="segmented">
        {SPEECH_MODELS.map((m) => (
          <button key={m.id} className={model === m.id ? 'active' : ''} onClick={() => setModel(m.id)} disabled={!!progress}>
            {m.label} <small>{m.size}</small>
          </button>
        ))}
      </div>
      {progress ? (
        <div className="ai-progress">
          <span>{PROGRESS_TEXT[progress.stage]}</span>
          {progress.stage === 'downloading' && (
            <div className="progress-bar">
              <div style={{ width: `${progress.progress * 100}%` }} />
            </div>
          )}
        </div>
      ) : (
        <button className="btn btn-primary" disabled={!target} onClick={() => void run()}>
          Generate captions
        </button>
      )}
      {message && <p className={message.error ? 'ai-message error' : 'ai-message'}>{message.text}</p>}
    </section>
  );
}

function SilenceTool() {
  const target = useEditor(soundTargetOf);
  const name = useClipName(target);
  const removeSilences = useEditor((s) => s.removeSilences);
  const [thresholdDb, setThresholdDb] = useState(DEFAULT_SILENCE.thresholdDb);
  const [minSilence, setMinSilence] = useState(DEFAULT_SILENCE.minSilence);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  function run() {
    if (!target) return;
    const result = removeSilences(target.id, { ...DEFAULT_SILENCE, thresholdDb, minSilence });
    if ('error' in result) setMessage({ text: result.error, error: true });
    else if (result.pauses === 0) setMessage({ text: 'No pauses long enough to remove.' });
    else
      setMessage({
        text: `Removed ${result.pauses} pause${result.pauses > 1 ? 's' : ''} (${result.seconds.toFixed(1)}s). Undo with Ctrl+Z.`,
      });
  }

  return (
    <section className="ai-card">
      <h4>Remove silences</h4>
      <p className="section-note">Cuts out pauses and dead air, keeping a little room around words.</p>
      <Target name={name} missing="Select a clip with sound, or move the playhead over one." />
      <label className="field slider-field">
        <span>Quieter than</span>
        <input type="range" min={-50} max={-15} value={thresholdDb} onChange={(e) => setThresholdDb(Number(e.target.value))} />
        <span className="field-value">{thresholdDb} dB</span>
      </label>
      <label className="field slider-field">
        <span>Pauses over</span>
        <input
          type="range"
          min={0.2}
          max={2}
          step={0.1}
          value={minSilence}
          onChange={(e) => setMinSilence(Number(e.target.value))}
        />
        <span className="field-value">{minSilence.toFixed(1)} s</span>
      </label>
      <button className="btn btn-primary" disabled={!target} onClick={run}>
        Remove silences
      </button>
      {message && <p className={message.error ? 'ai-message error' : 'ai-message'}>{message.text}</p>}
    </section>
  );
}

function BackgroundTool() {
  const target = useEditor(lookTargetOf);
  const name = useClipName(target);
  return (
    <section className="ai-card">
      <h4>Remove background</h4>
      <p className="section-note">Keeps the people in a video or photo and removes everything behind them.</p>
      <Target name={name} missing="Select a video or photo clip, or move the playhead over one." />
      {target && <BackgroundToggle clip={target} />}
    </section>
  );
}

/** On/off switch plus the model's loading state; also used in the clip's Video settings. */
export function BackgroundToggle({ clip }: { clip: Clip }) {
  const setRemoveBackground = useEditor((s) => s.setRemoveBackground);
  const { status, error } = useSegmenterStatus();
  return (
    <>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={!!clip.removeBackground}
          onChange={(e) => setRemoveBackground(clip.id, e.target.checked)}
        />
        Remove background
      </label>
      {clip.removeBackground && status === 'loading' && <p className="ai-message">Loading the cut-out model…</p>}
      {clip.removeBackground && status === 'failed' && (
        <p className="ai-message error">Background removal couldn't start: {error}</p>
      )}
    </>
  );
}
