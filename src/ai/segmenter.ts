import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { create } from 'zustand';
// Served from the app itself (not a CDN), so background removal works offline once loaded.
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

const MODEL_URL = `${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`;
/** Cut-outs are made at most this big (longest side); the compositor scales them like any source. */
const MAX_CUTOUT_SIZE = 1280;

type Status = 'idle' | 'loading' | 'ready' | 'failed';

/** Loading state of the person-segmentation model, for the UI. */
export const useSegmenterStatus = create<{ status: Status; error?: string }>(() => ({ status: 'idle' }));

let segmenter: ImageSegmenter | null = null;
let loading: Promise<ImageSegmenter> | null = null;

async function createSegmenter(delegate: 'GPU' | 'CPU'): Promise<ImageSegmenter> {
  // MediaPipe's code is only downloaded the first time someone removes a background.
  const { ImageSegmenter } = await import('@mediapipe/tasks-vision');
  return ImageSegmenter.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    },
  );
}

/**
 * Create a segmenter and check it can really process a frame: without WebGL
 * the GPU version can start up fine and only fail on its first image.
 */
async function workingSegmenter(delegate: 'GPU' | 'CPU'): Promise<ImageSegmenter> {
  const candidate = await createSegmenter(delegate);
  try {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 16;
    probe.getContext('2d')!.fillRect(0, 0, 16, 16);
    candidate.segment(probe).close();
    return candidate;
  } catch (error) {
    candidate.close();
    throw error;
  }
}

/** Load the model (once). Tries the GPU first and falls back to the CPU. */
export function ensureSegmenter(): Promise<ImageSegmenter> {
  if (segmenter) return Promise.resolve(segmenter);
  loading ??= (async () => {
    useSegmenterStatus.setState({ status: 'loading', error: undefined });
    try {
      segmenter = await workingSegmenter('GPU').catch(() => workingSegmenter('CPU'));
      useSegmenterStatus.setState({ status: 'ready' });
      return segmenter;
    } catch (error) {
      loading = null;
      useSegmenterStatus.setState({ status: 'failed', error: explain(error) });
      throw error;
    }
  })();
  return loading;
}

/** A message people can act on: the usual cause is graphics acceleration being unavailable. */
function explain(error: unknown): string {
  const hasWebGl = !!document.createElement('canvas').getContext('webgl2');
  if (!hasWebGl) {
    return 'it needs graphics acceleration (WebGL), which is turned off or not supported on this device.';
  }
  return (error as Error)?.message ?? String(error);
}

/** Stop using a model that failed mid-use, and tell the UI why. */
function disableSegmenter(error: unknown) {
  console.error('Background removal stopped:', error);
  segmenter?.close();
  segmenter = null;
  loading = null;
  useSegmenterStatus.setState({ status: 'failed', error: explain(error) });
}

/** The loaded model, or null (starting the load) if it isn't ready yet. */
function readySegmenter(): ImageSegmenter | null {
  if (!segmenter && useSegmenterStatus.getState().status !== 'failed') void ensureSegmenter().catch(() => {});
  return segmenter;
}

/**
 * Turns a frame into a cut-out of the people in it, with the background made
 * transparent. Keeps the last result per clip so a paused frame isn't
 * re-processed on every repaint.
 */
export class BackgroundRemover {
  private cache = new Map<string, { key: string; canvas: HTMLCanvasElement }>();
  private mask = document.createElement('canvas');

  /**
   * A cut-out of `source` (sourceW × sourceH), scaled by the returned `scale`,
   * or null while the model is still loading. `frameKey` identifies the frame
   * shown (e.g. the media time) for caching.
   */
  cutout(
    clipId: string,
    source: HTMLVideoElement | HTMLImageElement,
    sourceW: number,
    sourceH: number,
    frameKey: string,
  ): { canvas: HTMLCanvasElement; scale: number } | null {
    const scale = Math.min(1, MAX_CUTOUT_SIZE / Math.max(sourceW, sourceH));
    const cached = this.cache.get(clipId);
    if (cached?.key === frameKey) return { canvas: cached.canvas, scale };
    const model = readySegmenter();
    if (!model) return null;

    let result: ReturnType<ImageSegmenter['segment']>;
    try {
      result = model.segment(source);
    } catch (error) {
      // Show the clip unprocessed rather than breaking playback or export.
      disableSegmenter(error);
      return null;
    }
    const confidence = result.confidenceMasks?.[0];
    if (!confidence) {
      result.close();
      return null;
    }
    // Confidence (0..1 that a pixel is a person) becomes the mask's alpha.
    const { width, height } = confidence;
    const values = confidence.getAsFloat32Array();
    const pixels = new ImageData(width, height);
    for (let i = 0; i < values.length; i++) pixels.data[i * 4 + 3] = Math.round(values[i] * 255);
    result.close();
    this.mask.width = width;
    this.mask.height = height;
    this.mask.getContext('2d')!.putImageData(pixels, 0, 0);

    const canvas = cached?.canvas ?? document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceW * scale));
    canvas.height = Math.max(1, Math.round(sourceH * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    // Keep only the pixels the (smoothly scaled) mask marks as person.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.mask, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    this.cache.set(clipId, { key: frameKey, canvas });
    return { canvas, scale };
  }
}
