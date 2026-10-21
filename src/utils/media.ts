import type { MediaAsset, MediaKind } from '../types';
import { uid } from './id';

const THUMB_WIDTH = 160;

export function mediaKindOf(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

function once<T extends Event>(target: EventTarget, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    target.addEventListener(type, (e) => resolve(e as T), { once: true });
    target.addEventListener('error', () => reject(new Error(`Failed to load media`)), { once: true });
  });
}

function drawThumbnail(source: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = Math.max(1, Math.round((THUMB_WIDTH * height) / width));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

async function probeVideo(url: string) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.src = url;
  await once(video, 'loadedmetadata');
  const { duration, videoWidth: width, videoHeight: height } = video;
  // Grab a frame slightly in so we don't get a black first frame.
  video.currentTime = Math.min(0.5, duration / 2);
  await once(video, 'seeked');
  return { duration, width, height, thumbnail: drawThumbnail(video, width, height) };
}

async function probeImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const { naturalWidth: width, naturalHeight: height } = img;
  return { duration: 0, width, height, thumbnail: drawThumbnail(img, width, height) };
}

async function probeAudio(url: string) {
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.src = url;
  await once(audio, 'loadedmetadata');
  return { duration: audio.duration };
}

/** Read a user file into a MediaAsset, or null if the file type isn't supported. */
export async function importFile(file: File): Promise<MediaAsset | null> {
  const kind = mediaKindOf(file);
  if (!kind) return null;
  const url = URL.createObjectURL(file);
  try {
    const info =
      kind === 'video' ? await probeVideo(url) : kind === 'image' ? await probeImage(url) : await probeAudio(url);
    return { id: uid(), name: file.name, kind, url, ...info };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}
