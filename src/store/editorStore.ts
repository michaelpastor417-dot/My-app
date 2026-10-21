import { create } from 'zustand';
import type {
  Adjustments,
  CanvasBackground,
  Clip,
  EffectId,
  FilterId,
  MediaAsset,
  TextData,
  Timeline,
  Track,
  TrackKind,
  TransitionType,
} from '../types';
import { DEFAULT_TRANSITION_DURATION } from '../timeline/transitions';
import { BASE_TEXT, DEFAULT_TEXT_DURATION } from '../engine/text';
import { STICKER_TEXT, TEXT_PRESETS } from '../timeline/textPresets';
import { DEFAULT_TRANSFORM, NO_CROP } from '../engine/geometry';
import { DEFAULT_AUDIO } from '../engine/audio';
import { toggleKeyframe } from '../timeline/animation';
import {
  DEFAULT_IMAGE_DURATION,
  addTrack,
  clipsAt,
  clipsOnTrack,
  createTimeline,
  detachAudio,
  duplicateClip,
  insertFreezeFrame,
  mapClip,
  setClipSpeed,
  setReversed,
  setTransition,
  findFreeStart,
  getTrack,
  insertClip,
  moveClip,
  pruneEmptyTracks,
  type ClipPropsPatch,
  removeClip,
  setBackground,
  splitClip,
  timelineDuration,
  trimClip,
  updateClipText,
  updateClipProps,
  updateTrack,
} from '../timeline/model';
import { uid } from '../utils/id';

export const MIN_ZOOM = 10; // px per second
export const MAX_ZOOM = 400;
const HISTORY_LIMIT = 100;
/** Repeated edits of the same property within this window (e.g. a slider drag) undo as one step. */
const COALESCE_MS = 1000;

export const ASPECT_RATIOS = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:3': [1440, 1080],
  '3:4': [1080, 1440],
} as const;
export type AspectRatio = keyof typeof ASPECT_RATIOS;

/** Everything needed to show a project in the editor. */
export interface OpenedProject {
  projectId: string;
  projectName: string;
  projectCreatedAt: number;
  aspectRatio: AspectRatio;
  timeline: Timeline;
  assets: MediaAsset[];
}

interface EditorState {
  assets: MediaAsset[];
  timeline: Timeline;
  currentTime: number;
  isPlaying: boolean;
  selectedClipId: string | null;
  /** The main-track cut being edited, identified by the clip before it. Exclusive with selectedClipId. */
  selectedTransitionId: string | null;
  /** Timeline zoom in pixels per second. */
  zoom: number;
  aspectRatio: AspectRatio;
  /** The open project, or null on the home screen. */
  projectId: string | null;
  projectName: string;
  projectCreatedAt: number;
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'error';
  clipboard: Clip | null;

  /** Undo stack: earlier timelines, most recent last. */
  past: Timeline[];
  /** Redo stack: undone timelines, most recent last. */
  future: Timeline[];
  /** Timeline at the start of an in-progress drag, so the whole drag undoes as one step. */
  gestureBase: Timeline | null;

  addAssets: (assets: MediaAsset[]) => void;
  /** Fill in details found after import, such as the waveform. Not part of undo history. */
  updateAsset: (assetId: string, patch: Partial<MediaAsset>) => void;
  /** Move a video clip's sound onto its own audio clip (CapCut's "Extract audio"). */
  detachAudio: (clipId: string) => void;
  /**
   * Put an asset on the timeline. With no `trackId`, visual media goes on the
   * main track and audio on a new audio track. `trackId: 'new'` always makes a new track.
   */
  addToTimeline: (assetId: string, opts?: { trackId?: string; at?: number }) => void;
  /** Add a text clip from a preset, or an emoji sticker, at the playhead (or `opts.at`). */
  addText: (source: { presetId: string } | { sticker: string }, opts?: { trackId?: string; at?: number }) => void;
  updateText: (clipId: string, patch: Partial<TextData>, coalesceKey?: string) => void;
  moveClip: (clipId: string, start: number, trackId: string) => void;
  deleteSelected: () => void;
  splitAtPlayhead: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  paste: () => void;
  toggleTrackFlag: (trackId: string, flag: 'muted' | 'hidden' | 'locked') => void;
  /**
   * Edit a clip's transform/crop as an undoable step. Consecutive edits with
   * the same `coalesceKey` (e.g. one slider being dragged) merge into one step.
   */
  updateClip: (clipId: string, patch: ClipPropsPatch, coalesceKey?: string) => void;
  /** Edit a clip's transform/crop during a gesture started with `beginGesture`. */
  updateClipLive: (clipId: string, patch: ClipPropsPatch) => void;
  setBackground: (background: CanvasBackground, coalesceKey?: string) => void;
  setSpeed: (clipId: string, speed: number, coalesceKey?: string) => void;
  toggleReverse: (clipId: string) => void;
  /** Add a keyframe at the playhead capturing the clip's current values, or remove the one there. */
  toggleKeyframe: (clipId: string) => void;
  /** Insert a 3-second still of the frame at the playhead (selected clip, else the main-track clip). */
  freezeFrame: () => void;
  setFilter: (clipId: string, filter: Clip['filter'] | null, coalesceKey?: string) => void;
  setAdjustment: (clipId: string, key: keyof Adjustments, value: number) => void;
  resetAdjustments: (clipId: string) => void;
  setEffect: (clipId: string, effect: Clip['effect'] | null, coalesceKey?: string) => void;
  /** Set the transition after main-track clip `clipId` (null removes it). */
  setTransition: (clipId: string, transition: Clip['transition'] | null, coalesceKey?: string) => void;
  /** Library clicks: apply to the selected clip, else the main-track clip under the playhead. */
  applyFilter: (id: FilterId) => void;
  applyEffect: (id: EffectId) => void;
  /** Library click: apply to the selected cut, else the main-track cut nearest the playhead. */
  applyTransition: (type: TransitionType) => void;
  selectTransition: (clipId: string | null) => void;

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
  setProjectName: (name: string) => void;
  /** Replace everything with a project's contents (fresh history, playhead at 0). */
  openProject: (project: OpenedProject) => void;
  /** Back to the home screen. */
  closeProject: () => void;
}

function newTrack(kind: TrackKind): Track {
  return { id: uid(), kind, isMain: false, muted: false, hidden: false, locked: false };
}

/**
 * The clip a filter or effect picked from the library applies to: the
 * selected visual media clip, else the main-track clip under the playhead.
 */
export function lookTargetOf(
  state: Pick<EditorState, 'timeline' | 'assets' | 'selectedClipId' | 'currentTime'>,
): Clip | undefined {
  const { timeline, assets, selectedClipId, currentTime } = state;
  const visualMedia = (c: Clip) =>
    !c.text &&
    !c.audioOnly &&
    assets.find((a) => a.id === c.assetId)?.kind !== 'audio' &&
    !isClipLocked(timeline, c);
  const selected = timeline.clips.find((c) => c.id === selectedClipId);
  if (selected && visualMedia(selected)) return selected;
  return clipsAt(timeline, currentTime).find((c) => c.trackId === 'main' && visualMedia(c));
}

export function isClipLocked(timeline: Timeline, clip: Clip): boolean {
  return !!getTrack(timeline, clip.trackId)?.locked;
}

/**
 * Resolve which track a new clip of `kind` should land on. Falls back to the
 * main track (visual media), an existing text track with room at `at` (text),
 * or a fresh track when the requested one is missing, locked, or of the wrong kind.
 */
function resolveTrack(
  timeline: Timeline,
  kind: TrackKind,
  requested: string | undefined,
  at: number,
  duration: number,
): [Timeline, string] {
  const track = requested && requested !== 'new' ? getTrack(timeline, requested) : undefined;
  if (track && track.kind === kind && !track.locked) return [timeline, track.id];
  if (requested !== 'new') {
    const main = getTrack(timeline, 'main')!;
    if (kind === 'video' && !main.locked) return [timeline, main.id];
    if (kind === 'text') {
      const free = timeline.tracks.find(
        (t) => t.kind === 'text' && !t.locked && findFreeStart(clipsOnTrack(timeline, t.id), at, duration) === at,
      );
      if (free) return [timeline, free.id];
    }
  }
  const created = newTrack(kind);
  return [addTrack(timeline, created), created.id];
}

export const useEditor = create<EditorState>((set, get) => {
  let lastCoalesce: { key: string; at: number } | null = null;

  /** Replace the timeline as one undoable step, keeping selection and playhead valid. */
  function commit(next: Timeline, extra: Partial<EditorState> = {}, coalesceKey?: string) {
    const { timeline, past } = get();
    if (next === timeline) return;
    const now = Date.now();
    const merge =
      coalesceKey !== undefined && lastCoalesce?.key === coalesceKey && now - lastCoalesce.at < COALESCE_MS;
    lastCoalesce = coalesceKey === undefined ? null : { key: coalesceKey, at: now };
    set({
      timeline: next,
      // When merging, the history already holds the state from before this run of edits.
      past: merge ? past : [...past, timeline].slice(-HISTORY_LIMIT),
      future: [],
      ...extra,
    });
    afterTimelineChange();
  }

  function afterTimelineChange() {
    const { timeline, selectedClipId, selectedTransitionId, currentTime } = get();
    set({
      selectedClipId: timeline.clips.some((c) => c.id === selectedClipId) ? selectedClipId : null,
      selectedTransitionId: timeline.clips.some((c) => c.id === selectedTransitionId) ? selectedTransitionId : null,
      currentTime: Math.min(currentTime, timelineDuration(timeline)),
    });
  }

  function assetFor(clip: Clip) {
    return get().assets.find((a) => a.id === clip.assetId);
  }

  function trackKindOf(clip: Pick<Clip, 'text' | 'assetId' | 'audioOnly'>): TrackKind {
    if (clip.text) return 'text';
    if (clip.audioOnly) return 'audio';
    return assetFor(clip as Clip)?.kind === 'audio' ? 'audio' : 'video';
  }

  /** How far a clip can be stretched: its media's length, or unbounded for images and text. */
  function sourceDurationOf(clip: Clip): number | null {
    if (clip.text || clip.freezeAt !== undefined) return Infinity;
    const asset = assetFor(clip);
    if (!asset) return null;
    return asset.kind === 'image' ? Infinity : asset.duration;
  }

  /** The playhead, held inside the clip, so keyframe edits always land on the clip. */
  function editTime(clip: Clip): number {
    return Math.min(Math.max(get().currentTime, clip.start), clip.start + clip.duration);
  }

  /** Commit `fn` applied to an editable (unlocked) clip. */
  function editClip(clipId: string, fn: (timeline: Timeline, clip: Clip) => Timeline, coalesceKey?: string) {
    const { timeline } = get();
    const clip = timeline.clips.find((c) => c.id === clipId);
    if (clip && !isClipLocked(timeline, clip)) commit(fn(timeline, clip), {}, coalesceKey && `${clipId}:${coalesceKey}`);
  }

  const lookTarget = () => lookTargetOf(get());

  /** Place a clip (new or pasted) on the timeline, choosing its track and position. */
  function place(template: Omit<Clip, 'trackId' | 'start'>, opts: { trackId?: string; at?: number }) {
    const kind = trackKindOf(template);
    const at = opts.at ?? get().currentTime;
    const [timeline, trackId] = resolveTrack(get().timeline, kind, opts.trackId, at, template.duration);
    const clip: Clip = { ...template, trackId, start: 0 };
    // The main track appends unless dropped at a spot; everything else lands at the playhead, like CapCut.
    commit(insertClip(timeline, clip, trackId === 'main' ? opts.at : at), { selectedClipId: clip.id });
  }

  return {
    assets: [],
    timeline: createTimeline(),
    currentTime: 0,
    isPlaying: false,
    selectedClipId: null,
    selectedTransitionId: null,
    zoom: 60,
    aspectRatio: '16:9',
    projectId: null,
    projectName: '',
    projectCreatedAt: 0,
    saveStatus: 'saved',
    clipboard: null,
    past: [],
    future: [],
    gestureBase: null,

    addAssets: (assets) => set((s) => ({ assets: [...s.assets, ...assets] })),

    updateAsset: (assetId, patch) =>
      set((s) => ({ assets: s.assets.map((a) => (a.id === assetId ? { ...a, ...patch } : a)) })),

    detachAudio: (clipId) => {
      const { timeline } = get();
      const clip = timeline.clips.find((c) => c.id === clipId);
      if (!clip || isClipLocked(timeline, clip)) return;
      commit(detachAudio(timeline, clipId, uid(), newTrack('audio')));
    },

    addToTimeline: (assetId, opts = {}) => {
      const asset = get().assets.find((a) => a.id === assetId);
      if (!asset) return;
      const duration = asset.kind === 'image' ? DEFAULT_IMAGE_DURATION : asset.duration;
      place(
        { id: uid(), assetId, inPoint: 0, speed: 1, duration, transform: DEFAULT_TRANSFORM, crop: NO_CROP, audio: DEFAULT_AUDIO },
        opts,
      );
    },

    addText: (source, opts = {}) => {
      const preset = 'presetId' in source ? TEXT_PRESETS.find((p) => p.id === source.presetId) : undefined;
      const text: TextData =
        'sticker' in source
          ? { ...BASE_TEXT, ...STICKER_TEXT, content: source.sticker }
          : { ...BASE_TEXT, ...preset?.text };
      const transform = { ...DEFAULT_TRANSFORM, ...preset?.transform };
      place(
        { id: uid(), text, inPoint: 0, speed: 1, duration: DEFAULT_TEXT_DURATION, transform, crop: NO_CROP, audio: DEFAULT_AUDIO },
        opts,
      );
    },

    updateText: (clipId, patch, coalesceKey) => {
      const { timeline } = get();
      const clip = timeline.clips.find((c) => c.id === clipId);
      if (!clip?.text || isClipLocked(timeline, clip)) return;
      commit(updateClipText(timeline, clipId, patch), {}, coalesceKey && `${clipId}:text-${coalesceKey}`);
    },

    moveClip: (clipId, start, trackId) => {
      const { timeline } = get();
      const clip = timeline.clips.find((c) => c.id === clipId);
      if (!clip || isClipLocked(timeline, clip) || getTrack(timeline, trackId)?.locked) return;
      commit(pruneEmptyTracks(moveClip(timeline, clipId, start, trackId)));
    },

    deleteSelected: () => {
      const { selectedClipId, selectedTransitionId, timeline } = get();
      if (selectedTransitionId) {
        get().setTransition(selectedTransitionId, null);
        set({ selectedTransitionId: null });
        return;
      }
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
      if (!clipboard || (!clipboard.text && !assetFor(clipboard))) return;
      const { id: _id, trackId, start: _start, ...rest } = clipboard;
      place({ ...rest, id: uid() }, { trackId, at: get().currentTime });
    },

    toggleTrackFlag: (trackId, flag) => {
      const track = getTrack(get().timeline, trackId);
      if (!track) return;
      const next = updateTrack(get().timeline, trackId, { [flag]: !track[flag] });
      const deselect = flag === 'locked' && !track.locked;
      const selected = get().timeline.clips.find((c) => c.id === get().selectedClipId);
      commit(next, deselect && selected?.trackId === trackId ? { selectedClipId: null } : {});
    },

    updateClip: (clipId, patch, coalesceKey) =>
      editClip(clipId, (t, clip) => updateClipProps(t, clipId, patch, editTime(clip)), coalesceKey),

    updateClipLive: (clipId, patch) => {
      const { timeline, gestureBase } = get();
      const clip = timeline.clips.find((c) => c.id === clipId);
      if (!gestureBase || !clip || isClipLocked(timeline, clip)) return;
      set({ timeline: updateClipProps(timeline, clipId, patch, editTime(clip)) });
    },

    setSpeed: (clipId, speed, coalesceKey) =>
      editClip(clipId, (t) => pruneEmptyTracks(setClipSpeed(t, clipId, speed, newTrack('video'))), coalesceKey),

    toggleReverse: (clipId) => editClip(clipId, (t, clip) => setReversed(t, clipId, !clip.reversed)),

    toggleKeyframe: (clipId) => editClip(clipId, (t, clip) => mapClip(t, clipId, (c) => toggleKeyframe(c, editTime(clip)))),

    setFilter: (clipId, filter, coalesceKey) =>
      editClip(clipId, (t) => mapClip(t, clipId, (c) => ({ ...c, filter: filter ?? undefined })), coalesceKey),

    setAdjustment: (clipId, key, value) =>
      editClip(clipId, (t) => mapClip(t, clipId, (c) => ({ ...c, adjust: { ...c.adjust, [key]: value } })), `adjust-${key}`),

    resetAdjustments: (clipId) => editClip(clipId, (t) => mapClip(t, clipId, (c) => ({ ...c, adjust: undefined }))),

    setEffect: (clipId, effect, coalesceKey) =>
      editClip(clipId, (t) => mapClip(t, clipId, (c) => ({ ...c, effect: effect ?? undefined })), coalesceKey),

    setTransition: (clipId, transition, coalesceKey) =>
      editClip(clipId, (t) => setTransition(t, clipId, transition), coalesceKey),

    applyFilter: (id) => {
      const target = lookTarget();
      if (target) get().setFilter(target.id, { id, intensity: target.filter?.intensity ?? 1 });
    },

    applyEffect: (id) => {
      const target = lookTarget();
      if (target) get().setEffect(target.id, { id, intensity: target.effect?.intensity ?? 0.6 });
    },

    applyTransition: (type) => {
      const { timeline, selectedTransitionId, currentTime } = get();
      const main = clipsOnTrack(timeline, 'main');
      // Cuts are identified by the clip before them; the last clip has no cut after it.
      const cuts = main.slice(0, -1);
      const chosen =
        cuts.find((c) => c.id === selectedTransitionId) ??
        [...cuts].sort(
          (a, b) =>
            Math.abs(a.start + a.duration - currentTime) - Math.abs(b.start + b.duration - currentTime),
        )[0];
      if (!chosen) return;
      const duration = chosen.transition?.duration ?? DEFAULT_TRANSITION_DURATION;
      get().setTransition(chosen.id, { type, duration });
      set({ selectedTransitionId: chosen.id, selectedClipId: null });
    },

    freezeFrame: () => {
      const { timeline, currentTime, selectedClipId } = get();
      // The selected clip if it's under the playhead, otherwise the main-track clip there.
      const under = clipsAt(timeline, currentTime).filter(
        (c) => !isClipLocked(timeline, c) && !c.text && assetFor(c)?.kind === 'video' && !c.audioOnly,
      );
      const target = under.find((c) => c.id === selectedClipId) ?? under.find((c) => c.trackId === 'main');
      if (!target) return;
      const freeze = uid();
      commit(insertFreezeFrame(timeline, target.id, currentTime, { right: uid(), freeze }), { selectedClipId: freeze });
    },

    setBackground: (background, coalesceKey) =>
      commit(setBackground(get().timeline, background), {}, coalesceKey && `bg:${coalesceKey}`),

    beginGesture: () => set({ gestureBase: get().timeline }),

    trimGesture: (clipId, edge, time) => {
      const base = get().gestureBase;
      const clip = base?.clips.find((c) => c.id === clipId);
      const sourceDuration = clip && sourceDurationOf(clip);
      if (!base || !clip || sourceDuration == null || isClipLocked(base, clip)) return;
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

    select: (clipId) => set({ selectedClipId: clipId, selectedTransitionId: null }),

    selectTransition: (clipId) => set({ selectedTransitionId: clipId, selectedClipId: null }),

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

    setProjectName: (projectName) => set({ projectName }),

    openProject: (project) =>
      set({
        ...project,
        currentTime: 0,
        isPlaying: false,
        selectedClipId: null,
        selectedTransitionId: null,
        clipboard: null,
        past: [],
        future: [],
        gestureBase: null,
        saveStatus: 'saved',
      }),

    closeProject: () =>
      set({
        projectId: null,
        isPlaying: false,
        assets: [],
        timeline: createTimeline(),
        selectedClipId: null,
        selectedTransitionId: null,
        past: [],
        future: [],
      }),
  };
});
