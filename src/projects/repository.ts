import { uid } from '../utils/id';
import { FILES, PROJECTS, get, getAll, getAllKeys, put, remove } from './db';
import {
  type ProjectDocument,
  type ProjectSummary,
  copyName,
  referencedFileIds,
  summarize,
  upgrade,
} from './document';

/** Projects for the home screen, most recently edited first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const docs = await getAll<ProjectDocument>(PROJECTS);
  return docs.map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<ProjectDocument | undefined> {
  const doc = await get<ProjectDocument>(PROJECTS, id);
  return doc && upgrade(doc);
}

export async function saveProject(doc: ProjectDocument): Promise<void> {
  await put(PROJECTS, doc);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const doc = await get<ProjectDocument>(PROJECTS, id);
  if (doc) await put(PROJECTS, { ...doc, name, updatedAt: Date.now() });
}

/** Copy a project. Media files are shared, not copied. Returns the copy's id. */
export async function duplicateProject(id: string): Promise<string | undefined> {
  const doc = await get<ProjectDocument>(PROJECTS, id);
  if (!doc) return undefined;
  const names = (await listProjects()).map((p) => p.name);
  const now = Date.now();
  const copy: ProjectDocument = { ...doc, id: uid(), name: copyName(doc.name, names), createdAt: now, updatedAt: now };
  await put(PROJECTS, copy);
  return copy.id;
}

/** Delete a project and any media files no other project uses. */
export async function deleteProject(id: string): Promise<void> {
  await remove(PROJECTS, id);
  await collectUnusedFiles();
}

/** Remove stored media that no project references (e.g. after deleting a project). */
export async function collectUnusedFiles(): Promise<void> {
  const used = referencedFileIds(await getAll<ProjectDocument>(PROJECTS));
  for (const key of await getAllKeys(FILES)) {
    if (!used.has(String(key))) await remove(FILES, key);
  }
}

/** Keep an imported file. Its asset id is the key, so projects sharing the asset share the file. */
export async function storeFile(assetId: string, file: Blob): Promise<void> {
  await put(FILES, file, assetId);
}

export async function loadFile(assetId: string): Promise<Blob | undefined> {
  return get<Blob>(FILES, assetId);
}
