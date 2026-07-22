import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface BookMeta {
  id: string; // Typically a UUID or derived from title
  title: string;
  author: string;
  coverImage?: string; // base64 or blob URL
  dateAdded: number;
  progress: number;
}

export interface SyncPoint {
  paragraph_id: string;
  timestamp_ms: number;
  confidence: number | null;
}

export interface ContentBlock {
  id: string;
  tag: string;
  text: string;
  src?: string;
  needs_review: boolean;
}

interface ReadAlongDB extends DBSchema {
  books: {
    key: string;
    value: BookMeta;
    indexes: { 'by-date': number };
  };
  paragraphs: {
    key: string; // bookId
    value: { bookId: string; data: ContentBlock[] };
  };
  audio_files: {
    key: string; // bookId
    value: { bookId: string; blob: Blob | File };
  };
  sync_maps: {
    key: string; // bookId
    value: { bookId: string; points: SyncPoint[] };
  };
  epub_images: {
    key: string; // bookId
    value: { bookId: string; images: Record<string, Uint8Array> };
  };
}

let dbPromise: Promise<IDBPDatabase<ReadAlongDB>> | null = null;

export function initDB() {
  if (!dbPromise) {
    // BUMP THIS NUMBER TO 4! 
    dbPromise = openDB<ReadAlongDB>('readalong-db', 4, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          const bookStore = db.createObjectStore('books', { keyPath: 'id' });
          bookStore.createIndex('by-date', 'dateAdded');
        }
        if (!db.objectStoreNames.contains('paragraphs')) {
          db.createObjectStore('paragraphs', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('audio_files')) {
          db.createObjectStore('audio_files', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('sync_maps')) {
          db.createObjectStore('sync_maps', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('epub_images')) {
          db.createObjectStore('epub_images', { keyPath: 'bookId' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveBook(
  meta: BookMeta,
  paragraphs: ContentBlock[],
  audio: Blob | File,
  syncMap: SyncPoint[],
  images: Record<string, Uint8Array> = {}
) {
  const db = await initDB();
  const tx = db.transaction(['books', 'paragraphs', 'audio_files', 'sync_maps', 'epub_images'], 'readwrite');
  
  await tx.objectStore('books').put(meta);
  await tx.objectStore('paragraphs').put({ bookId: meta.id, data: paragraphs });
  await tx.objectStore('audio_files').put({ bookId: meta.id, blob: audio });
  await tx.objectStore('sync_maps').put({ bookId: meta.id, points: syncMap });
  await tx.objectStore('epub_images').put({ bookId: meta.id, images });
  
  await tx.done;
}

export async function getBooks(): Promise<BookMeta[]> {
  const db = await initDB();
  return db.getAllFromIndex('books', 'by-date');
}

export async function getBookData(bookId: string) {
  const db = await initDB();
  const tx = db.transaction(['books', 'paragraphs', 'audio_files', 'sync_maps', 'epub_images'], 'readonly');
  
  const meta = await tx.objectStore('books').get(bookId);
  const pData = await tx.objectStore('paragraphs').get(bookId);
  const aData = await tx.objectStore('audio_files').get(bookId);
  const sData = await tx.objectStore('sync_maps').get(bookId);
  const imgData = await tx.objectStore('epub_images').get(bookId);
  
  return {
    meta,
    paragraphs: pData?.data || [],
    audioBlob: aData?.blob,
    syncMap: sData?.points || [],
    images: imgData?.images || {}
  };
}

export async function deleteBook(bookId: string) {
  const db = await initDB();
  const tx = db.transaction(['books', 'paragraphs', 'audio_files', 'sync_maps', 'epub_images'], 'readwrite');
  
  await tx.objectStore('books').delete(bookId);
  await tx.objectStore('paragraphs').delete(bookId);
  await tx.objectStore('audio_files').delete(bookId);
  await tx.objectStore('sync_maps').delete(bookId);
  await tx.objectStore('epub_images').delete(bookId);
  
  await tx.done;
}
