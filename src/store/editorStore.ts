import { create } from 'zustand';
import type { Clip, MediaAsset, Timeline, Track, TrackKind } from '../types';
import {
  DEFAULT_IMAGE_DURATION,
  addTrack,
  clipsAt,
  createTimeline,
  duplicateClip,
  getTrack,
  insertClip,
  moveClip,
  pruneEmptyTracks,
  removeClip,
  splitClip,
  timelineDuration,
  trimClip,
  updateTrack,
} from '../timeline/model';
import { uid } from '../utils/id';

export const MIN_ZOOM = 10; // px per second
export const MAX_ZOOM = 400;
const HISTORY_LIMIT = 100;

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
  clipboard: Clip | null;

  /** Undo stack: earlier timelines, most recent last. */
  past: Timeline[];
  /** Redo stack: undone timelines, most recent last. */
  future: Timeline[];
  /** Timeline at the start of an in-progress drag, so the whole drag undoes as one step. */
  gestureBase: Timeline | null;

  addAssets: (assets: MediaAsset[]) => void;
  /**
   * Put an asset on the timeline. With no `trackId`, visual media goes on the
   * main track and audio on a new audio track. `trackId: 'new'` always makes a new track.
   */
  addToTimeline: (assetId: string, opts?: { trackId?: string; at?: number }) => void;
  moveClip: (clipId: string, start: number, trackId: string) => void;
  deleteSelected: () => void;
  splitAtPlayhead: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  paste: () => void;
  toggleTrackFlag: (trackId: string, flag: 'muted' | 'hidden' | 'locked') => void;

  /** Begin a live edit (e.g. a trim drag); updates (e.g. `trimGesture`) undo as one step. */
  beginGesture: () => void;
  trimGesture: (clipId: string, edge: 'start' | 'end', time: number) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;

  select: (clipId: string | null) => void;
  seek: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setZoom: (zoom: number) => void;
  setAspectRatio: (ratio: AspectRatio) => void;
}

function newTrack(kind: TrackKind): Track {
  return { id: uid(), kind, isMain: false, muted: false, hidden: false, locked: false };
}

export function isClipLocked(timeline: Timeline, clip: Clip): boolean {
  return !!getTrack(timeline, clip.trackId)?.locked;
}

/**
 * Resolve which track a new clip of `kind` should land on. Falls back to the
 * main track (visual media) or a fresh track when the requested one is
 * missing, locked, or of the wrong kind.
 */
function resolveTrack(timeline: Timeline, kind: TrackKind, requested?: string): [Timeline, string] {
  const track = requested && requested !== 'new' ? getTrack(timeline, requested) : undefined;
  if (track && track.kind === kind && !track.locked) return [timeline, track.id];
  const main = getTrack(timeline, 'main')!;
  if (kind === 'video' && requested !== 'new' && !main.locked) return [timeline, main.id];
  const created = newTrack(kind);
  return [addTrack(timeline, created), created.id];
}

export const useEditor = create<EditorState>((set, get) => {
  /** Replace the timeline as one undoable step, keeping selection and playhead valid. */
  function commit(next: Timeline, extra: Partial<EditorState> = {}) {
    const { timeline, past } = get();
    if (next === timeline) return;
    set({
      timeline: next,
      past: [...past, timeline].slice(-HISTORY_LIMIT),
      future: [],
      ...extra,
    });
    afterTimelineChange();
  }

  function afterTimelineChange() {
    const { timeline, selectedClipId, currentTime } = get();
    set({
      selectedClipId: timeline.clips.some((c) => c.id === selectedClipId) ? selectedClipId : null,
      currentTime: Math.min(currentTime, timelineDuration(timeline)),
    });
  }

  function assetFor(clip: Clip) {
    return get().assets.find((a) => a.id === clip.assetId);
  }

  /** Place a clip (new or pasted) on the timeline, choosing its track and position. */
  function place(template: Omit<Clip, 'trackId' | 'start'>, kind: TrackKind, opts: { trackId?: string; at?: number }) {
    const [timeline, trackId] = resolveTrack(get().timeline, kind, opts.trackId);
    const clip: Clip = { ...template, trackId, start: 0 };
    // Overlays and audio default to the playhead position, like CapCut.
    const at = opts.at ?? (trackId === 'main' ? undefined : get().currentTime);
    commit(insertClip(timeline, clip, at), { selectedClipId: clip.id });
  }

  return {
    assets: [],
    timeline: createTimeline(),
    currentTime: 0,
    isPlaying: false,
    selectedClipId: null,
    zoom: 60,
    aspectRatio: '16:9',
    clipboard: null,
    past: [],
    future: [],
    gestureBase: null,

    addAssets: (assets) => set((s) => ({ assets: [...s.assets, ...assets] })),

    addToTimeline: (assetId, opts = {}) => {
      const asset = get().assets.find((a) => a.id === assetId);
      if (!asset) return;
      const duration = asset.kind === 'image' ? DEFAULT_IMAGE_DURATION : asset.duration;
      place({ id: uid(), assetId, inPoint: 0, duration }, asset.kind === 'audio' ? 'audio' : 'video', opts);
    },

    moveClip: (clipId, start, trackId) => {
      const { timeline } = get();
      const clip = timeline.clips.find((c) => c.id === clipId);
      if (!clip || isClipLocked(timeline, clip) || getTrack(timeline, trackId)?.locked) return;
      commit(pruneEmptyTracks(moveClip(timeline, clipId, start, trackId)));
    },

    deleteSelected: () => {
      const { selectedClipId, timeline } = get();
      const clip = timeline.clips.find((c) => c.id === selectedClipId);
      if (!clip || isClipLocked(timeline, clip)) return;
      commit(pruneEmptyTracks(removeClip(timeline, clip.id)), { selectedClipId: null });
    },

    splitAtPlayhead: () => {
      const { timeline, currentTime, selectedClipId } = get();
      const under = clipsAt(timeline, currentTime).filter((c) => !isClipLocked(timeline, c));
      // Split just the selected clip if it's under the playhead, otherwise everything there.
      const selected = under.find((c) => c.id === selectedClipId);
      const targets = selected ? [selected] : under;
      const next = targets.reduce((t, c) => splitClip(t, c.id, currentTime, uid()), timeline);
      commit(next);
    },

    duplicateSelected: () => {
      const { timeline, selectedClipId } = get();
      const clip = timeline.clips.find((c) => c.id === selectedClipId);
      if (!clip || isClipLocked(timeline, clip)) return;
      const id = uid();
      commit(duplicateClip(timeline, clip.id, id), { selectedClipId: id });
    },

    copySelected: () => {
      const { timeline, selectedClipId } = get();
      const clip = timeline.clips.find((c) => c.id === selectedClipId);
      if (clip) set({ clipboard: clip });
    },

    paste: () => {
      const { clipboard } = get();
      const asset = clipboard && assetFor(clipboard);
      if (!clipboard || !asset) return;
      const { id: _id, trackId, start: _start, ...rest } = clipboard;
      place({ ...rest, id: uid() }, asset.kind === 'audio' ? 'audio' : 'video', {
        trackId,
        at: get().currentTime,
      });
    },

    toggleTrackFlag: (trackId, flag) => {
      const track = getTrack(get().timeline, trackId);
      if (!track) return;
      const next = updateTrack(get().timeline, trackId, { [flag]: !track[flag] });
      const deselect = flag === 'locked' && !track.locked;
      const selected = get().timeline.clips.find((c) => c.id === get().selectedClipId);
      commit(next, deselect && selected?.trackId === trackId ? { selectedClipId: null } : {});
    },

    beginGesture: () => set({ gestureBase: get().timeline }),

    trimGesture: (clipId, edge, time) => {
      const base = get().gestureBase;
      const clip = base?.clips.find((c) => c.id === clipId);
      const asset = clip && assetFor(clip);
      if (!base || !clip || !asset || isClipLocked(base, clip)) return;
      const sourceDuration = asset.kind === 'image' ? Infinity : asset.duration;
      set({ timeline: trimClip(base, clipId, edge, time, sourceDuration) });
    },

    endGesture: () => {
      const { gestureBase, timeline, past } = get();
      if (!gestureBase) return;
      set({ gestureBase: null });
      if (gestureBase !== timeline) {
        set({ past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [] });
        afterTimelineChange();
      }
    },

    undo: () => {
      const { past, future, timeline } = get();
      if (past.length === 0) return;
      set({ timeline: past[past.length - 1], past: past.slice(0, -1), future: [...future, timeline] });
      afterTimelineChange();
    },

    redo: () => {
      const { past, future, timeline } = get();
      if (future.length === 0) return;
      set({ timeline: future[future.length - 1], future: future.slice(0, -1), past: [...past, timeline] });
      afterTimelineChange();
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
  };
});
