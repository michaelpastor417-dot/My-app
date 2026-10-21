import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { importMedia } from '../projects/session';
import { formatTime } from '../utils/time';

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  /** Timeline position where the voiceover will be placed. */
  at: number;
  startedAt: number;
}

/**
 * Records from the microphone while the timeline plays, then adds the take as
 * a new audio clip starting where recording began.
 */
export function VoiceoverButton() {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const takeCount = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((performance.now() - recording.startedAt) / 1000), 200);
    return () => clearInterval(timer);
  }, [recording]);

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone unavailable or permission denied.');
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const store = useEditor.getState();
    const at = store.currentTime;
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => void finish(new Blob(chunks, { type: recorder.mimeType }), at);
    recorder.start();
    store.setPlaying(true);
    setElapsed(0);
    setRecording({ recorder, stream, at, startedAt: performance.now() });
  }

  function stop() {
    if (!recording) return;
    recording.recorder.stop();
    recording.stream.getTracks().forEach((t) => t.stop());
    useEditor.getState().setPlaying(false);
    setRecording(null);
  }

  async function finish(blob: Blob, at: number) {
    takeCount.current += 1;
    const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
    const file = new File([blob], `Voiceover ${takeCount.current}.${extension}`, { type: blob.type || 'audio/webm' });
    const { imported, noSpace } = await importMedia([file]);
    if (!imported.length) {
      setError(noSpace ? "The recording couldn't be saved: storage is full." : "The recording couldn't be read.");
      return;
    }
    useEditor.getState().addToTimeline(imported[0].id, { trackId: 'new', at });
  }

  return (
    <>
      {recording ? (
        <button className="tool-btn recording" onClick={stop} title="Stop recording">
          ■ Stop · {formatTime(elapsed)}
        </button>
      ) : (
        <button className="tool-btn" onClick={start} title="Record a voiceover from your microphone">
          🎙 Record
        </button>
      )}
      {error && <span className="toolbar-error">{error}</span>}
    </>
  );
}
