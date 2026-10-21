import { create } from 'zustand';
import type { Clip, MediaAsset, Timeline, Track, TrackKind } from '../types';
import {
  DEFAULT_IMAGE_DURATION,
  addTrack,
  createTimeline,
  insertClip,
  moveClip,
  pruneEmptyTracks,
  removeClip,
  timelineDuration,
} from '../timeline/model';
import { uid } from '../utils/id';

export const MIN_ZOOM = 10; // px per second
export const MAX_ZOOM = 400;

export const ASPECT_RATIOS = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:3': [1440, 1080],
  '3:4': [1080, 1440],
} as const;
export type AspectRatio = keyof typeof ASPECT_RATIOS;

interface EditorState {
  assets: MediaAsset[];
  timeline: Timeline;
  currentTime: number;
  isPlaying: boolean;
  selectedClipId: string | null;
  /** Timeline zoom in pixels per second. */
  zoom: number;
  aspectRatio: AspectRatio;

  addAssets: (assets: MediaAsset[]) => void;
  /**
   * Put an asset on the timeline. With no `trackId`, visual media goes on the
   * main track and audio on a new audio track. `trackId: 'new'` always makes a new track.
   */
  addToTimeline: (assetId: string, opts?: { trackId?: string; at?: number }) => void;
  moveClip: (clipId: string, start: number, trackId: string) => void;
  deleteSelected: () => void;
  select: (clipId: string | null) => void;
  seek: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setZoom: (zoom: number) => void;
  setAspectRatio: (ratio: AspectRatio) => void;
}

function newTrack(kind: TrackKind): Track {
  return { id: uid(), kind, isMain: false, muted: false, hidden: false };
}

export const useEditor = create<EditorState>((set, get) => ({
  assets: [],
  timeline: createTimeline(),
  currentTime: 0,
  isPlaying: false,
  selectedClipId: null,
  zoom: 60,
  aspectRatio: '16:9',

  addAssets: (assets) => set((s) => ({ assets: [...s.assets, ...assets] })),

  addToTimeline: (assetId, opts = {}) => {
    const asset = get().assets.find((a) => a.id === assetId);
    if (!asset) return;
    const kind: TrackKind = asset.kind === 'audio' ? 'audio' : 'video';
    let timeline = get().timeline;

    let trackId = opts.trackId;
    const requested = trackId && timeline.tracks.find((t) => t.id === trackId);
    if (requested && requested.kind !== kind) trackId = undefined;
    if (!trackId || trackId === 'new' || !requested) {
      if (kind === 'video' && trackId !== 'new') {
        trackId = 'main';
      } else {
        const track = newTrack(kind);
        timeline = addTrack(timeline, track);
        trackId = track.id;
      }
    }

    const clip: Clip = {
      id: uid(),
      assetId,
      trackId,
      start: 0,
      inPoint: 0,
      duration: asset.kind === 'image' ? DEFAULT_IMAGE_DURATION : asset.duration,
    };
    // Overlays and audio default to the playhead position, like CapCut.
    const at = opts.at ?? (trackId === 'main' ? undefined : get().currentTime);
    set({ timeline: insertClip(timeline, clip, at), selectedClipId: clip.id });
  },

  moveClip: (clipId, start, trackId) =>
    set((s) => ({ timeline: pruneEmptyTracks(moveClip(s.timeline, clipId, start, trackId)) })),

  deleteSelected: () => {
    const { selectedClipId, timeline, currentTime } = get();
    if (!selectedClipId) return;
    const next = pruneEmptyTracks(removeClip(timeline, selectedClipId));
    set({
      timeline: next,
      selectedClipId: null,
      currentTime: Math.min(currentTime, timelineDuration(next)),
    });
  },

  select: (clipId) => set({ selectedClipId: clipId }),

  seek: (time) => set({ currentTime: Math.max(0, Math.min(time, timelineDuration(get().timeline))) }),

  setPlaying: (playing) => {
    const { currentTime, timeline } = get();
    const duration = timelineDuration(timeline);
    if (playing && duration === 0) return;
    // Pressing play at the end restarts from the beginning.
    if (playing && currentTime >= duration) set({ currentTime: 0 });
    set({ isPlaying: playing });
  },

  togglePlay: () => get().setPlaying(!get().isPlaying),

  setZoom: (zoom) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }),

  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
}));
