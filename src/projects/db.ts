/**
 * A tiny promise wrapper over IndexedDB, the browser's built-in database.
 * Two stores: `projects` (one document per project) and `files` (imported
 * media as Blobs, keyed by asset id, shared between projects).
 */

const DB_NAME = 'clipforge';
const DB_VERSION = 1;
export const PROJECTS = 'projects';
export const FILES = 'files';

let opening: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

/** For tests: forget the open connection so a fresh database can be used. */
export function resetDbConnection() {
  opening = null;
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return promised(db.transaction(store).objectStore(store).get(key));
}

export async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return promised(db.transaction(store).objectStore(store).getAll());
}

export async function getAllKeys(store: string): Promise<IDBValidKey[]> {
  const db = await openDb();
  return promised(db.transaction(store).objectStore(store).getAllKeys());
}

export async function put(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDb();
  await promised(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
}

export async function remove(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  await promised(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}
