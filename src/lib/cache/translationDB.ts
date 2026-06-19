// IndexedDB cache for per-page block translations. Keyed by
// fileHash:model:lang:page so a whole book persists across sessions.
'use client';

const DB_NAME = 'book2english';
const STORE = 'translations';
const BOOK_STORE = 'currentBook';
const VERSION = 2;

type PageRecord = {
  key: string; // `${fileHash}:${model}:${lang}:${page}`
  fileHash: string;
  blocks: Record<string, string>; // blockId -> translated text
};

export type StoredBook = { fileHash: string; name: string; bytes: ArrayBuffer };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('fileHash', 'fileHash', { unique: false });
      }
      if (!db.objectStoreNames.contains(BOOK_STORE)) {
        db.createObjectStore(BOOK_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Persist the currently-open PDF so a refresh resumes it instead of dropping
// back to the upload screen. Only the most recent book is kept.
export async function saveCurrentBook(book: StoredBook): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(BOOK_STORE, 'readwrite');
      tx.objectStore(BOOK_STORE).put(book, 'last');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort
  }
}

export async function loadCurrentBook(): Promise<StoredBook | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(BOOK_STORE, 'readonly');
      const req = tx.objectStore(BOOK_STORE).get('last');
      req.onsuccess = () => resolve((req.result as StoredBook | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function clearCurrentBook(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(BOOK_STORE, 'readwrite');
      tx.objectStore(BOOK_STORE).delete('last');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

function pageKey(fileHash: string, model: string, lang: string, page: number) {
  return `${fileHash}:${model}:${lang}:${page}`;
}

export async function getCachedPage(
  fileHash: string,
  model: string,
  lang: string,
  page: number
): Promise<Record<string, string>> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(pageKey(fileHash, model, lang, page));
      req.onsuccess = () => resolve((req.result as PageRecord | undefined)?.blocks ?? {});
      req.onerror = () => resolve({});
    });
  } catch {
    return {};
  }
}

export async function putCachedPage(
  fileHash: string,
  model: string,
  lang: string,
  page: number,
  blocks: Record<string, string>
): Promise<void> {
  try {
    const db = await openDB();
    const existing = await getCachedPage(fileHash, model, lang, page);
    const merged = { ...existing, ...blocks };
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        key: pageKey(fileHash, model, lang, page),
        fileHash,
        blocks: merged,
      } satisfies PageRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort cache
  }
}

// Remove every cached page for one book (all models/languages).
export async function clearBook(fileHash: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const idx = store.index('fileHash');
      const req = idx.openCursor(IDBKeyRange.only(fileHash));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}
