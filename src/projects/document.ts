import type { MediaAsset, Timeline } from '../types';
import type { AspectRatio } from '../store/editorStore';

/** Bump when the saved shape changes, and add a step to `upgrade`. */
export const PROJECT_VERSION = 1;

/** Imported media as saved: everything except the session-only object URL. */
export type StoredAsset = Omit<MediaAsset, 'url' | 'missing'>;

/** One project as stored in the database. */
export interface ProjectDocument {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspectRatio: AspectRatio;
  timeline: Timeline;
  assets: StoredAsset[];
  /** Small JPEG data URL of the player, for the home screen. */
  thumbnail?: string;
  /** Timeline length in seconds, for the home screen. */
  duration: number;
}

/** What the home screen lists; the timeline and media stay unloaded. */
export type ProjectSummary = Pick<ProjectDocument, 'id' | 'name' | 'updatedAt' | 'thumbnail' | 'duration' | 'aspectRatio'>;

export function storedAsset(asset: MediaAsset): StoredAsset {
  const { url: _url, missing: _missing, ...rest } = asset;
  return rest;
}

export function summarize(doc: ProjectDocument): ProjectSummary {
  const { id, name, updatedAt, thumbnail, duration, aspectRatio } = doc;
  return { id, name, updatedAt, thumbnail, duration, aspectRatio };
}

/**
 * Bring a document saved by an older version of the app up to date.
 * Throws for documents from a newer version, which this app can't read safely.
 */
export function upgrade(doc: ProjectDocument): ProjectDocument {
  if (doc.version > PROJECT_VERSION) {
    throw new Error('This project was saved by a newer version of ClipForge.');
  }
  // Version 1 is the first saved format; future migrations go here, oldest first.
  return doc;
}

/** Ids of the stored media files these projects use (a project keeps every file it imported). */
export function referencedFileIds(docs: Pick<ProjectDocument, 'assets'>[]): Set<string> {
  return new Set(docs.flatMap((d) => d.assets.map((a) => a.id)));
}

/** "Name", "Name copy", "Name copy 2", … avoiding names already taken. */
export function copyName(name: string, taken: string[]): string {
  const base = `${name.replace(/ copy( \d+)?$/, '')} copy`;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`;
}
