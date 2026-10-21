import type { Clip, MediaAsset } from '../types';
import { decodeAudio } from '../utils/media';
import type { SpeechChunk } from './captions';

/** Whisper works on 16 kHz mono audio. */
const SAMPLE_RATE = 16000;

export const SPEECH_MODELS = [
  { id: 'Xenova/whisper-tiny', label: 'Fast', size: '≈40 MB' },
  { id: 'Xenova/whisper-base', label: 'Accurate', size: '≈80 MB' },
] as const;

export const LANGUAGES: [code: string, label: string][] = [
  ['', 'Detect automatically'],
  ['english', 'English'],
  ['spanish', 'Spanish'],
  ['french', 'French'],
  ['german', 'German'],
  ['portuguese', 'Portuguese'],
  ['italian', 'Italian'],
  ['dutch', 'Dutch'],
  ['turkish', 'Turkish'],
  ['russian', 'Russian'],
  ['arabic', 'Arabic'],
  ['hindi', 'Hindi'],
  ['indonesian', 'Indonesian'],
  ['japanese', 'Japanese'],
  ['korean', 'Korean'],
  ['chinese', 'Chinese'],
];

export interface WorkerRequest {
  audio: Float32Array;
  model: string;
  language: string | null;
}

export type WorkerResponse =
  | { type: 'download'; progress: number }
  | { type: 'status'; status: 'loading' | 'listening' }
  | { type: 'done'; chunks: SpeechChunk[] }
  | { type: 'error'; message: string };

export type TranscribeProgress =
  | { stage: 'preparing' }
  | { stage: 'downloading'; progress: number }
  | { stage: 'loading' }
  | { stage: 'listening' };

let worker: Worker | null = null;

/** Plain-language explanation for the errors people actually hit. */
export function friendlyError(message: string): string {
  if (/fetch|network|load failed|ERR_|status code 4|status code 5/i.test(message)) {
    return "the speech model couldn't be downloaded. It's needed once (then kept by the browser), so check your internet connection and try again.";
  }
  if (/memory|allocation/i.test(message)) {
    return 'this device ran out of memory. Try the Fast model or a shorter clip.';
  }
  return message;
}

/** The part of the clip's source it plays, as 16 kHz mono samples. */
async function clipAudio(clip: Clip, asset: MediaAsset): Promise<Float32Array> {
  const buffer = await decodeAudio(asset.url, SAMPLE_RATE);
  const from = Math.floor(clip.inPoint * SAMPLE_RATE);
  const to = Math.min(buffer.length, Math.ceil((clip.inPoint + clip.duration * clip.speed) * SAMPLE_RATE));
  const mono = new Float32Array(Math.max(0, to - from));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += data[from + i] / buffer.numberOfChannels;
  }
  return mono;
}

/**
 * Recognise the speech in a clip on this device. Returns chunks timed in the
 * clip's source media (ready for `addCaptions`). The first run downloads the
 * model, which the browser then keeps.
 */
export async function transcribeClip(
  clip: Clip,
  asset: MediaAsset,
  options: { model: string; language: string | null },
  onProgress: (p: TranscribeProgress) => void,
): Promise<SpeechChunk[]> {
  onProgress({ stage: 'preparing' });
  const audio = await clipAudio(clip, asset);
  worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  return new Promise((resolve, reject) => {
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'download') onProgress({ stage: 'downloading', progress: msg.progress });
      if (msg.type === 'status') onProgress({ stage: msg.status });
      if (msg.type === 'done') resolve(msg.chunks.map((c) => ({ ...c, start: c.start + clip.inPoint, end: c.end + clip.inPoint })));
      if (msg.type === 'error') reject(new Error(friendlyError(msg.message)));
    };
    w.onerror = (event) => reject(new Error(event.message || 'The speech recogniser stopped unexpectedly.'));
    w.postMessage({ audio, ...options } satisfies WorkerRequest, [audio.buffer]);
  });
}
