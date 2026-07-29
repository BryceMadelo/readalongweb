import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface BookMeta {
  id: string; // Typically a UUID or derived from title
  title: string;
  author: string;
  coverImage?: string; // base64 or blob URL
  dateAdded: number;
  progress: number;
  isFavorite?: boolean;
  genre?: string;
  durationMs?: number;
  hasAudio?: boolean;
}

export interface HistoryActivity {
  id: string;
  type: string;
  message: string;
  bookId?: string;
  timestamp: number;
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
  history: {
    key: string;
    value: HistoryActivity;
    indexes: { 'by-date': number };
  };
}

let dbPromise: Promise<IDBPDatabase<ReadAlongDB>> | null = null;

export function initDB() {
  if (!dbPromise) {
    // BUMP THIS NUMBER TO 5! 
    dbPromise = openDB<ReadAlongDB>('readalong-db', 5, {
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
        if (!db.objectStoreNames.contains('history')) {
          const historyStore = db.createObjectStore('history', { keyPath: 'id' });
          historyStore.createIndex('by-date', 'timestamp');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveBook(
  meta: BookMeta,
  paragraphs: ContentBlock[],
  audio: Blob | File | undefined,
  syncMap: SyncPoint[],
  images: Record<string, Uint8Array> = {}
) {
  const db = await initDB();
  const tx = db.transaction(['books', 'paragraphs', 'audio_files', 'sync_maps', 'epub_images'], 'readwrite');
  
  await tx.objectStore('books').put(meta);
  await tx.objectStore('paragraphs').put({ bookId: meta.id, data: paragraphs });
  if (audio !== undefined) {
    await tx.objectStore('audio_files').put({ bookId: meta.id, blob: audio });
  }
  await tx.objectStore('sync_maps').put({ bookId: meta.id, points: syncMap });
  await tx.objectStore('epub_images').put({ bookId: meta.id, images });
  
  await tx.done;
}

export async function updateSyncMap(bookId: string, syncMap: SyncPoint[]) {
  const db = await initDB();
  const tx = db.transaction('sync_maps', 'readwrite');
  await tx.objectStore('sync_maps').put({ bookId, points: syncMap });
  await tx.done;
}

export async function updateBookMeta(bookId: string, title: string, author: string) {
  const db = await initDB();
  const tx = db.transaction('books', 'readwrite');
  const store = tx.objectStore('books');
  const meta = await store.get(bookId);
  if (meta) {
    meta.title = title;
    meta.author = author;
    await store.put(meta);
  }
  await tx.done;
}

export async function updateBookProgress(bookId: string, progress: number) {
  const db = await initDB();
  const tx = db.transaction('books', 'readwrite');
  const store = tx.objectStore('books');
  const meta = await store.get(bookId);
  if (meta) {
    meta.progress = progress;
    await store.put(meta);
  }
  await tx.done;

  // Sync to server
  const API_URL = import.meta.env.VITE_API_URL || '/api';
  try {
    const token = localStorage.getItem('readalong_api_token');
    if (token) {
      await fetch(`${API_URL}/progress/${bookId}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ progress_ms: Math.round(progress) })
      });
    }
  } catch (e) {
    console.error("Failed to sync progress to server:", e);
  }
}

export async function getBooks(): Promise<BookMeta[]> {
  const db = await initDB();
  return db.getAllFromIndex('books', 'by-date');
}

export async function getBookData(bookId: string) {
  const db = await initDB();
  
  // Read existing data
  const tx = db.transaction(['books', 'paragraphs', 'audio_files', 'sync_maps', 'epub_images'], 'readonly');
  const meta = await tx.objectStore('books').get(bookId);
  const pData = await tx.objectStore('paragraphs').get(bookId);

  const sData = await tx.objectStore('sync_maps').get(bookId);
  const imgData = await tx.objectStore('epub_images').get(bookId);
  await tx.done;
  
  // Need to import API functions dynamically to avoid circular dependencies if any
  const { getEpubBlob, getSyncMap } = await import('../utils/api');

  // We no longer download the audio blob into IndexedDB.
  // Instead, the Reader component will stream the audio directly from the backend.
  const hasAudio = Boolean(meta && (meta as BookMeta).hasAudio);

  let paragraphs = pData?.data || [];
  const images = imgData?.images || {};

  if (paragraphs.length === 0) {
    try {
      const epubBlob = await getEpubBlob(bookId);
      const arrayBuffer = await epubBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const { load_epub_paragraphs, load_epub_images } = await import('readalong-wasm');
      
      const epubData = load_epub_paragraphs(bytes);
      
      const writeTx = db.transaction(['paragraphs', 'epub_images'], 'readwrite');
      if (!epubData.error) {
        paragraphs = epubData.blocks.filter((b: ContentBlock) => 
          b.tag === 'img' || (b.text && b.text.trim().length > 0)
        );
        await writeTx.objectStore('paragraphs').put({ bookId, data: paragraphs });
      }

      const rawImages = load_epub_images(bytes); 
      for (let i = 0; i < rawImages.length; i++) {
        const [path, data] = rawImages[i];
        images[path] = data;
      }
      if (Object.keys(images).length > 0) {
         await writeTx.objectStore('epub_images').put({ bookId, images });
      }
      await writeTx.done;
    } catch (e) {
      console.warn('Could not fetch or parse EPUB for book', bookId, e);
    }
  }

  let syncMap = sData?.points || [];
  if (syncMap.length === 0) {
    try {
      syncMap = await getSyncMap(bookId);
      if (syncMap.length > 0) {
        const writeTx = db.transaction(['sync_maps'], 'readwrite');
        await writeTx.objectStore('sync_maps').put({ bookId, points: syncMap });
        await writeTx.done;
      }
    } catch (e) {
      console.warn('Could not fetch sync map for book', bookId, e);
    }
  }

  return {
    meta,
    paragraphs,
    hasAudio,
    syncMap,
    images
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

export async function getStats() {
  const books = await getBooks();
  let hoursListened = 0;

  for (const book of books) {
    if (book.progress > 0) {
      hoursListened += book.progress / (1000 * 60 * 60);
    }
    
    const db = await initDB();
    const tx = db.transaction(['sync_maps'], 'readonly');
    const sData = await tx.objectStore('sync_maps').get(book.id);
    if (sData && sData.points.length > 0) {
      const lastPoint = sData.points[sData.points.length - 1];
      const totalMs = lastPoint.timestamp_ms;
      if (totalMs > 0) {
        // if (book.progress >= totalMs * 0.95) {
        //   booksRead += 1;
        // }
      }
    }
  }

  return {
    booksRead: books.length, // Display books in library instead of completed books
    hoursListened: Math.round(hoursListened * 10) / 10, // Round to 1 decimal place
    streak: 0 // Optional placeholder
  };
}

export async function toggleFavorite(bookId: string): Promise<boolean> {
  const db = await initDB();
  const tx = db.transaction('books', 'readwrite');
  const book = await tx.store.get(bookId);
  let isFavorite = false;
  if (book) {
    isFavorite = !book.isFavorite;
    book.isFavorite = isFavorite;
    await tx.store.put(book);
  }
  await tx.done;
  return isFavorite;
}

export async function addHistory(type: string, message: string, bookId?: string) {
  const db = await initDB();
  const tx = db.transaction('history', 'readwrite');
  const id = crypto.randomUUID();
  await tx.store.put({
    id,
    type,
    message,
    bookId,
    timestamp: Date.now()
  });
  await tx.done;
}

export async function getHistory(): Promise<HistoryActivity[]> {
  const db = await initDB();
  return db.getAllFromIndex('history', 'by-date');
}
