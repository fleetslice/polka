export type BookFormat =
  | 'epub' | 'fb2' | 'pdf' | 'mobi' | 'azw3' | 'djvu' | 'docx' | 'doc' | 'odt'
  | 'rtf' | 'txt' | 'cbz' | 'cbr' | 'html' | 'mp3' | 'm4b';

/** text — перетекаемый текст по главам; pages — постраничные изображения (сканы, комиксы); audio — аудиокнига. */
export type BookKind = 'text' | 'pages' | 'audio';
export type BookStatus = 'new' | 'reading' | 'finished';

/** Общие поля синхронизируемых записей: last-write-wins по updatedAt, при равенстве — по deviceId. */
export interface Synced {
  updatedAt: number;
  deviceId: string;
  deleted?: 0 | 1;
}

export interface Book extends Synced {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  kind: BookKind;
  /** Подпись источника текста для читалки, например «PDF → ТЕКСТОВЫЙ СЛОЙ». */
  sourceLabel: string;
  cover?: string; // data URL (уменьшенная обложка)
  color: string; // цвет корешка
  pages: number;
  size: number;
  lengthChars: number;
  shelfId: string | null;
  status: BookStatus;
  progress: number; // 0..1
  addedFrom: string;
  hash: string;
  createdAt: number;
  lastReadAt?: number;
  lang?: string;
}

export interface Shelf extends Synced {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface Chapter {
  id: string;
  bookId: string;
  parentId: string | null;
  order: number;
  level: number;
  title: string;
  /** Смещение начала главы в символах от начала книги. Для pages-книг — номер первой страницы (с 1). */
  start: number;
  lengthChars: number;
  startPage: number;
  endPage: number;
}

/** Содержимое главы: очищенный HTML и чистый текст (для поиска, RAG, выделений). */
export interface ChapterContent {
  bookId: string;
  order: number;
  html: string;
  text: string;
}

export interface ChapterProgress extends Synced {
  bookId: string;
  chapterId: string;
  percent: number; // 0..1
  finishedAt?: number;
  lastReadAt: number;
}

/** Локатор: номер главы + смещение в символах текста главы (text) либо номер страницы (pages). */
export interface Locator {
  chapter: number;
  offset: number;
}

export interface Position extends Synced {
  bookId: string;
  chapterId: string;
  locator: Locator;
  percent: number;
}

export interface ReadingSession extends Synced {
  id: string;
  bookId: string;
  startedAt: number;
  endedAt: number;
  pagesRead: number;
  charsRead: number;
}

export type HighlightColor = 'accent' | 'orange';

export interface Highlight extends Synced {
  id: string;
  bookId: string;
  chapterId: string;
  chapter: number;
  start: number;
  end: number;
  text: string;
  color: HighlightColor;
  createdAt: number;
}

export type NoteKind = 'quote' | 'thought' | 'ai';

export interface Note extends Synced {
  id: string;
  bookId: string | null;
  chapterId?: string;
  highlightId?: string;
  kind: NoteKind;
  bodyMd: string;
  tags: string[];
  page?: number;
  locator?: Locator;
  createdAt: number;
}

export interface Flashcard extends Synced {
  id: string;
  noteId: string | null;
  bookId: string | null;
  front: string;
  back: string;
  ease: number;
  interval: number;
  reps: number;
  dueAt: number;
}

export interface Bookmark extends Synced {
  id: string;
  bookId: string;
  locator: Locator;
  label: string;
  createdAt: number;
}

export interface Device extends Synced {
  id: string;
  name: string;
  lastSeen: number;
}

export type InsightSection = 'summary' | 'characters' | 'context' | 'debates' | 'cards' | 'chapter_recap';

export interface AiInsight {
  key: string; // `${bookId}:${section}:${chapterId ?? ''}`
  bookId: string;
  chapterId?: string;
  section: InsightSection;
  content: unknown;
  model: string;
  createdAt: number;
}

export type JobStage = 'upload' | 'convert' | 'ocr' | 'chapters' | 'index' | 'ai' | 'done' | 'error';

export interface ImportJob {
  id: string;
  fileName: string;
  format: string;
  stage: JobStage;
  progress: number; // 0..1
  message: string;
  error?: string;
  bookId?: string;
  createdAt: number;
}

export interface CloudSource {
  id: string;
  provider: 'gdrive' | 'yandex' | 'dropbox' | 'onedrive' | 'icloud' | 'webdav';
  folder: string;
  enabled: boolean;
}

/** Результат разбора файла до записи в базу. */
export interface ParsedChapter {
  title: string;
  level: number;
  html: string;
  /** Для PDF: страница, с которой начинается глава. */
  startPage?: number;
  endPage?: number;
}

export interface ParsedBook {
  kind: BookKind;
  title: string;
  author: string;
  lang?: string;
  cover?: Blob;
  pages?: number;
  sourceLabel: string;
  chapters: ParsedChapter[];
}
