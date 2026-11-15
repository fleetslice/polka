import Dexie, { type Table } from 'dexie';
import type {
  AiInsight, Book, Bookmark, Chapter, ChapterContent, ChapterProgress, CloudSource, Device,
  Flashcard, Highlight, ImportJob, Note, Position, ReadingSession, Shelf,
} from './types';

export interface StoredFile { bookId: string; name: string; type: string; blob: Blob }
export interface Meta { key: string; value: unknown }
/** Очередь изменений для досинхронизации с сервером, когда появится сеть. */
export interface OutboxItem { seq?: number; table: string; key: string; updatedAt: number }

export class PolkaDB extends Dexie {
  books!: Table<Book, string>;
  files!: Table<StoredFile, string>;
  shelves!: Table<Shelf, string>;
  chapters!: Table<Chapter, string>;
  contents!: Table<ChapterContent, [string, number]>;
  chapterProgress!: Table<ChapterProgress, [string, string]>;
  positions!: Table<Position, [string, string]>;
  sessions!: Table<ReadingSession, string>;
  highlights!: Table<Highlight, string>;
  notes!: Table<Note, string>;
  flashcards!: Table<Flashcard, string>;
  bookmarks!: Table<Bookmark, string>;
  devices!: Table<Device, string>;
  insights!: Table<AiInsight, string>;
  jobs!: Table<ImportJob, string>;
  cloudSources!: Table<CloudSource, string>;
  meta!: Table<Meta, string>;
  outbox!: Table<OutboxItem, number>;

  constructor(name = 'polka') {
    super(name);
    this.version(1).stores({
      books: 'id, shelfId, hash, lastReadAt, createdAt, updatedAt',
      files: 'bookId',
      shelves: 'id, order, updatedAt',
      chapters: 'id, bookId, [bookId+order]',
      contents: '[bookId+order], bookId',
      chapterProgress: '[bookId+chapterId], bookId, updatedAt',
      positions: '[bookId+deviceId], bookId, updatedAt',
      sessions: 'id, bookId, endedAt, updatedAt',
      highlights: 'id, bookId, [bookId+chapter], updatedAt',
      notes: 'id, bookId, kind, createdAt, updatedAt',
      flashcards: 'id, noteId, bookId, dueAt, updatedAt',
      bookmarks: 'id, bookId, updatedAt',
      devices: 'id, updatedAt',
      insights: 'key, bookId',
      jobs: 'id, createdAt',
      cloudSources: 'id',
      meta: 'key',
      outbox: '++seq, [table+key]',
    });
  }
}

export const db = new PolkaDB();

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Таблицы, которые синхронизируются между устройствами. */
export const SYNCED_TABLES = [
  'books', 'shelves', 'chapterProgress', 'positions', 'sessions',
  'highlights', 'notes', 'flashcards', 'bookmarks', 'devices',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];
