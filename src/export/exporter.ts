import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  type Quality,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { Clip, MediaAsset, Timeline } from '../types';
import { clipsAt, timelineDuration } from '../timeline/model';
import { mediaTimeAt } from '../timeline/animation';
import { Compositor, type MediaEl } from '../engine/Compositor';
import { decodeAudio } from '../utils/media';
import { audibleClips, mixAudio } from './audioMix';
import { type QualityLevel, frameCount } from './settings';

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  quality: QualityLevel;
}

export interface ExportProgress {
  phase: 'preparing' | 'audio' | 'video' | 'finalizing';
  /** 0..1 within the whole export. */
  progress: number;
  frame?: number;
  frames?: number;
}

export interface ExportResult {
  blob: Blob;
  videoCodec: string;
  audioCodec: string | null;
}

const SAMPLE_RATE = 48000;
/** Seeks that take longer than this are given up on so a stuck video can't hang the export. */
const SEEK_TIMEOUT_MS = 3000;
const QUALITY: Record<QualityLevel, Quality> = { low: QUALITY_LOW, recommended: QUALITY_MEDIUM, high: QUALITY_HIGH };

/** Most compatible first: H.264/AAC plays everywhere; VP9/AV1 and Opus are fallbacks for browsers without them. */
const VIDEO_CODECS = ['avc', 'vp9', 'av1'] as const;
const AUDIO_CODECS = ['aac', 'opus'] as const;

function once(target: EventTarget, type: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    target.addEventListener(
      type,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function loadElement(clip: Clip, asset: MediaAsset): Promise<MediaEl | null> {
  if (asset.kind === 'image') {
    const img = new Image();
    img.src = asset.url;
    await img.decode().catch(() => {});
    return img;
  }
  if (asset.kind !== 'video' || clip.audioOnly) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = asset.url;
  await once(video, 'loadeddata', 10_000);
  return video;
}

/** Seek a video to an exact time and wait until that frame can be drawn. */
async function seekExactly(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 1e-4 && video.readyState >= 2) return;
  const seeked = once(video, 'seeked', SEEK_TIMEOUT_MS);
  video.currentTime = time;
  await seeked;
}

/**
 * Render the timeline to an MP4. Every frame is composited exactly as the
 * preview draws it, after seeking each video to that frame, so nothing is
 * dropped no matter how slow the machine is. Throws an AbortError if `signal` fires.
 */
export async function exportVideo(
  timeline: Timeline,
  assets: MediaAsset[],
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const { width, height, fps } = settings;
  const duration = timelineDuration(timeline);
  if (duration <= 0) throw new Error('The timeline is empty.');
  const quality = QUALITY[settings.quality];
  onProgress({ phase: 'preparing', progress: 0 });

  const videoCodec = await getFirstEncodableVideoCodec([...VIDEO_CODECS], { width, height, quality });
  if (!videoCodec) throw new Error("This browser can't encode video. Try the latest Chrome or Edge.");
  const withAudio = audibleClips(timeline, assets).length > 0;
  const audioCodec = withAudio
    ? await getFirstEncodableAudioCodec([...AUDIO_CODECS], { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality })
    : null;

  // Media elements of our own, so export seeking never disturbs the preview.
  const elements = new Map<string, MediaEl>();
  for (const clip of timeline.clips) {
    const asset = assets.find((a) => a.id === clip.assetId);
    const el = asset && (await loadElement(clip, asset));
    if (el) elements.set(clip.id, el);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const compositor = new Compositor(canvas, (clipId) => elements.get(clipId));

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, quality }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const abort = async () => {
    await output.cancel();
    throw new DOMException('Export cancelled', 'AbortError');
  };

  try {
    await output.start();

    if (audioSource) {
      onProgress({ phase: 'audio', progress: 0.02 });
      const mix = await mixAudio(timeline, assets, duration, SAMPLE_RATE, (asset) =>
        decodeAudio(asset.url, SAMPLE_RATE).catch(() => null),
      );
      if (signal.aborted) await abort();
      await audioSource.add(mix);
      audioSource.close();
    }

    const frames = frameCount(duration, fps);
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) await abort();
      const t = i / fps;
      const active = clipsAt(timeline, t);
      for (const clip of active) {
        const el = elements.get(clip.id);
        if (el instanceof HTMLVideoElement) {
          const latest = Math.max(0, el.duration - 1 / fps);
          await seekExactly(el, Math.min(latest, Math.max(0, mediaTimeAt(clip, t))));
        }
      }
      compositor.draw(timeline, assets, active, t);
      await videoSource.add(t, 1 / fps);
      onProgress({ phase: 'video', progress: 0.05 + 0.9 * ((i + 1) / frames), frame: i + 1, frames });
    }
    videoSource.close();

    onProgress({ phase: 'finalizing', progress: 0.97 });
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer!;
    onProgress({ phase: 'finalizing', progress: 1 });
    return { blob: new Blob([buffer], { type: 'video/mp4' }), videoCodec, audioCodec };
  } catch (error) {
    if (output.state !== 'canceled' && output.state !== 'finalized') await output.cancel().catch(() => {});
    throw error;
  } finally {
    for (const el of elements.values()) {
      if (el instanceof HTMLMediaElement) {
        el.removeAttribute('src');
        el.load();
      }
    }
  }
}
