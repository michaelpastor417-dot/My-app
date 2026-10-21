/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';
// The speech runtime is served from the app itself rather than a CDN.
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { WorkerRequest, WorkerResponse } from './transcribe';

env.allowLocalModels = false; // models come from the Hugging Face hub, then the browser cache
env.backends.onnx.wasm!.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

type Transcriber = (audio: Float32Array, options: object) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
const loaded = new Map<string, Promise<Transcriber>>();

const post = (message: WorkerResponse) => self.postMessage(message);

function load(model: string): Promise<Transcriber> {
  let p = loaded.get(model);
  if (!p) {
    p = pipeline('automatic-speech-recognition', model, {
      progress_callback: (info) => {
        if (info.status === 'progress_total') post({ type: 'download', progress: info.progress / 100 });
      },
    }) as unknown as Promise<Transcriber>;
    // Forget failed loads so a retry can try again.
    p.catch(() => loaded.delete(model));
    loaded.set(model, p);
  }
  return p;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { audio, model, language } = event.data;
  try {
    post({ type: 'status', status: 'loading' });
    const transcriber = await load(model);
    post({ type: 'status', status: 'listening' });
    const output = await transcriber(audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
      ...(language ? { language } : {}),
    });
    const duration = audio.length / 16000;
    post({
      type: 'done',
      chunks: (output.chunks ?? [{ text: output.text, timestamp: [0, duration] }]).map((c) => ({
        text: c.text,
        start: c.timestamp[0],
        end: c.timestamp[1] ?? duration,
      })),
    });
  } catch (error) {
    post({ type: 'error', message: (error as Error).message || String(error) });
  }
};
