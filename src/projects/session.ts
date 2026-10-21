import { type OpenedProject, useEditor } from '../store/editorStore';
import { createTimeline, timelineDuration } from '../timeline/model';
import type { MediaAsset } from '../types';
import { uid } from '../utils/id';
import { importFile, loadPeaks } from '../utils/media';
import { PROJECT_VERSION, type ProjectDocument, storedAsset } from './document';
import { loadFile, loadProject, saveProject, storeFile } from './repository';

/** How long edits settle before an autosave is written. */
const AUTOSAVE_DELAY_MS = 800;
const THUMBNAIL_WIDTH = 320;

let thumbnailCanvas: HTMLCanvasElement | null = null;

/** The player canvas, used to draw the home-screen thumbnail when saving. */
export function setThumbnailSource(canvas: HTMLCanvasElement | null) {
  thumbnailCanvas = canvas;
}

function captureThumbnail(): string | undefined {
  if (!thumbnailCanvas || thumbnailCanvas.width === 0) return undefined;
  const small = document.createElement('canvas');
  small.width = THUMBNAIL_WIDTH;
  small.height = Math.round((THUMBNAIL_WIDTH * thumbnailCanvas.height) / thumbnailCanvas.width);
  small.getContext('2d')!.drawImage(thumbnailCanvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', 0.7);
}

/** The open project as a document ready to store. */
function currentDocument(): ProjectDocument | null {
  const s = useEditor.getState();
  if (!s.projectId) return null;
  return {
    version: PROJECT_VERSION,
    id: s.projectId,
    name: s.projectName,
    createdAt: s.projectCreatedAt,
    updatedAt: Date.now(),
    aspectRatio: s.aspectRatio,
    timeline: s.timeline,
    assets: s.assets.map(storedAsset),
    thumbnail: captureThumbnail(),
    duration: timelineDuration(s.timeline),
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();

/** Write the open project now (waiting for any save already in progress). */
export function saveNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const doc = currentDocument();
  if (!doc) return saving;
  useEditor.setState({ saveStatus: 'saving' });
  saving = saving
    .then(() => saveProject(doc))
    .then(
      () => {
        // Only mark saved if nothing changed while we were writing.
        if (!saveTimer) useEditor.setState({ saveStatus: 'saved' });
      },
      (error) => {
        console.error('Autosave failed:', error);
        useEditor.setState({ saveStatus: 'error' });
      },
    );
  return saving;
}

function scheduleSave() {
  useEditor.setState({ saveStatus: 'unsaved' });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
}

/**
 * Save automatically whenever the project's content changes. Playhead moves,
 * selection and playback don't count as changes. Returns a stop function.
 */
export function startAutosave(): () => void {
  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (!s.projectId || s.projectId !== prev.projectId) return;
    if (
      s.timeline !== prev.timeline ||
      s.assets !== prev.assets ||
      s.aspectRatio !== prev.aspectRatio ||
      s.projectName !== prev.projectName
    ) {
      scheduleSave();
    }
  });
  // Last-chance save when the tab is hidden or closed.
  const flush = () => {
    if (saveTimer) void saveNow();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', flush);
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', flush);
  };
}

/** Object URLs for the open project's media, revoked when it closes. */
let openUrls: string[] = [];

function releaseUrls() {
  openUrls.forEach((u) => URL.revokeObjectURL(u));
  openUrls = [];
}

function show(project: OpenedProject) {
  releaseUrls();
  openUrls = project.assets.map((a) => a.url).filter(Boolean);
  useEditor.getState().openProject(project);
  // Waveforms that hadn't finished decoding when the project was last saved.
  for (const asset of project.assets) {
    if (asset.peaks === undefined && asset.kind !== 'image' && !asset.missing) {
      void loadPeaks(asset.url).then((peaks) => useEditor.getState().updateAsset(asset.id, { peaks }));
    }
  }
}

export async function createProject(name = 'Untitled project'): Promise<void> {
  // Ask the browser not to clear our storage when space runs low (best effort).
  void navigator.storage?.persist?.();
  show({
    projectId: uid(),
    projectName: name,
    projectCreatedAt: Date.now(),
    aspectRatio: '16:9',
    timeline: createTimeline(),
    assets: [],
  });
  await saveNow();
}

/** Open a saved project, reconnecting its media files. Returns false if it doesn't exist. */
export async function openProject(id: string): Promise<boolean> {
  const doc = await loadProject(id);
  if (!doc) return false;
  const assets: MediaAsset[] = await Promise.all(
    doc.assets.map(async (stored) => {
      const file = await loadFile(stored.id);
      return file ? { ...stored, url: URL.createObjectURL(file) } : { ...stored, url: '', missing: true };
    }),
  );
  show({
    projectId: doc.id,
    projectName: doc.name,
    projectCreatedAt: doc.createdAt,
    aspectRatio: doc.aspectRatio,
    timeline: doc.timeline,
    assets,
  });
  return true;
}

/** Save and go back to the home screen. */
export async function closeProject(): Promise<void> {
  await saveNow();
  useEditor.getState().closeProject();
  releaseUrls();
}

export interface ImportOutcome {
  imported: MediaAsset[];
  /** Files that aren't supported media. */
  unsupported: number;
  /** Files that couldn't be kept because storage is full. */
  noSpace: number;
}

/**
 * Import files into the open project: probe them, keep a copy in storage so
 * the project can be reopened later, and add them to the media library.
 */
export async function importMedia(files: File[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: [], unsupported: 0, noSpace: 0 };
  await Promise.all(
    files.map(async (file) => {
      const asset = await importFile(file);
      if (!asset) {
        outcome.unsupported++;
        return;
      }
      try {
        await storeFile(asset.id, file);
      } catch (error) {
        console.error('Could not store media file:', error);
        URL.revokeObjectURL(asset.url);
        outcome.noSpace++;
        return;
      }
      openUrls.push(asset.url);
      outcome.imported.push(asset);
    }),
  );
  const store = useEditor.getState();
  store.addAssets(outcome.imported);
  // Waveforms decode in the background; clips show them once ready.
  for (const asset of outcome.imported) {
    if (asset.kind !== 'image') void loadPeaks(asset.url).then((peaks) => store.updateAsset(asset.id, { peaks }));
  }
  return outcome;
}
