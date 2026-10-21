import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTimeline } from '../timeline/model';
import type { MediaAsset } from '../types';
import { resetDbConnection } from './db';
import { PROJECT_VERSION, type ProjectDocument, copyName, storedAsset, upgrade } from './document';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  loadFile,
  loadProject,
  renameProject,
  saveProject,
  storeFile,
} from './repository';

const asset = (id: string): MediaAsset => ({ id, name: `${id}.mp4`, kind: 'video', url: 'blob:x', duration: 2 });

function doc(id: string, assets: string[], updatedAt = 1): ProjectDocument {
  return {
    version: PROJECT_VERSION,
    id,
    name: `Project ${id}`,
    createdAt: 1,
    updatedAt,
    aspectRatio: '16:9',
    timeline: createTimeline(),
    assets: assets.map((a) => storedAsset(asset(a))),
    duration: 0,
  };
}

beforeEach(() => {
  // A fresh, empty database for every test.
  globalThis.indexedDB = new IDBFactory();
  resetDbConnection();
});

describe('project documents', () => {
  it('never stores the session-only object URL', () => {
    expect(storedAsset({ ...asset('a'), missing: true })).not.toHaveProperty('url');
    expect(storedAsset({ ...asset('a'), missing: true })).not.toHaveProperty('missing');
  });

  it('refuses projects from a newer app version', () => {
    expect(() => upgrade({ ...doc('p', []), version: PROJECT_VERSION + 1 })).toThrow(/newer version/);
    expect(upgrade(doc('p', [])).id).toBe('p');
  });

  it('names copies without clashing', () => {
    expect(copyName('Trip', ['Trip'])).toBe('Trip copy');
    expect(copyName('Trip', ['Trip', 'Trip copy'])).toBe('Trip copy 2');
    expect(copyName('Trip copy', ['Trip copy', 'Trip copy 2'])).toBe('Trip copy 3');
  });
});

describe('repository', () => {
  it('saves, lists newest first and loads projects', async () => {
    await saveProject(doc('old', [], 1));
    await saveProject(doc('new', [], 5));
    expect((await listProjects()).map((p) => p.id)).toEqual(['new', 'old']);
    expect((await loadProject('old'))?.name).toBe('Project old');
    expect(await loadProject('missing')).toBeUndefined();
  });

  it('renames a project and bumps its edit time', async () => {
    await saveProject(doc('p', [], 1));
    await renameProject('p', 'Holiday');
    const [p] = await listProjects();
    expect(p.name).toBe('Holiday');
    expect(p.updatedAt).toBeGreaterThan(1);
  });

  it('duplicates a project sharing its media', async () => {
    await saveProject(doc('p', ['clip']));
    await storeFile('clip', new Blob(['video-bytes']));
    const copyId = await duplicateProject('p');
    const copy = await loadProject(copyId!);
    expect(copy).toMatchObject({ name: 'Project p copy', assets: [{ id: 'clip' }] });
    expect(copy!.id).not.toBe('p');
  });

  it('deleting a project removes only media no other project uses', async () => {
    await saveProject(doc('a', ['shared', 'onlyA']));
    await saveProject(doc('b', ['shared']));
    await storeFile('shared', new Blob(['s']));
    await storeFile('onlyA', new Blob(['a']));
    await deleteProject('a');
    expect(await loadFile('shared')).toBeDefined();
    expect(await loadFile('onlyA')).toBeUndefined();
    expect((await listProjects()).map((p) => p.id)).toEqual(['b']);
  });

  it('keeps file contents intact', async () => {
    await storeFile('f', new Blob(['hello']));
    expect(await (await loadFile('f'))!.text()).toBe('hello');
  });
});
