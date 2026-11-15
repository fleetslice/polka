import { db, uid } from './db';
import { deviceId, queue, stamp } from './device';
import { bookProgress, clamp01, pageOfChar } from './progress';
import { SM2_INITIAL, sm2 } from './sm2';
import type { Book, Chapter, Flashcard, Highlight, HighlightColor, Locator, Note, NoteKind, Shelf } from './types';

export async function createShelf(name: string): Promise<Shelf> {
  const order = (await db.shelves.count()) + 1;
  const shelf: Shelf = { id: uid(), name: name.trim().slice(0, 40), color: '', order, ...stamp() };
  await db.shelves.put(shelf);
  await queue('shelves', shelf.id);
  return shelf;
}

export async function renameShelf(id: string, name: string): Promise<void> {
  await db.shelves.update(id, { name: name.trim().slice(0, 40), ...stamp() });
  await queue('shelves', id);
}

export async function reorderShelves(ids: string[]): Promise<void> {
  await db.transaction('rw', db.shelves, db.outbox, async () => {
    for (const [i, id] of ids.entries()) {
      await db.shelves.update(id, { order: i + 1, ...stamp() });
      await queue('shelves', id);
    }
  });
}

export async function deleteShelf(id: string): Promise<void> {
  await db.transaction('rw', db.shelves, db.books, db.outbox, async () => {
    const books = await db.books.where('shelfId').equals(id).toArray();
    for (const b of books) {
      await db.books.update(b.id, { shelfId: null, ...stamp() });
      await queue('books', b.id);
    }
    await db.shelves.update(id, { deleted: 1, ...stamp() });
    await queue('shelves', id);
  });
}

export async function moveBook(bookId: string, shelfId: string | null): Promise<void> {
  await db.books.update(bookId, { shelfId, ...stamp() });
  await queue('books', bookId);
}

export async function deleteBook(bookId: string): Promise<void> {
  await db.transaction('rw', [db.books, db.files, db.chapters, db.contents, db.insights, db.outbox], async () => {
    await db.books.update(bookId, { deleted: 1, cover: undefined, ...stamp() });
    await db.files.delete(bookId);
    await db.chapters.where('bookId').equals(bookId).delete();
    await db.contents.where('bookId').equals(bookId).delete();
    await db.insights.where('bookId').equals(bookId).delete();
    await queue('books', bookId);
  });
}

/** Сохраняет позицию чтения, прогресс главы (не уменьшается при возврате назад) и прогресс книги. */
export async function savePosition(book: Book, chapters: Chapter[], locator: Locator, readTo = locator.offset): Promise<number> {
  const chapter = chapters[locator.chapter];
  if (!chapter) return book.progress;
  const now = Date.now();
  const percent = clamp01(chapter.lengthChars ? readTo / chapter.lengthChars : 1);
  return db.transaction('rw', [db.chapterProgress, db.positions, db.books, db.outbox], async () => {
    const prev = await db.chapterProgress.get([book.id, chapter.id]);
    const best = Math.max(prev?.percent ?? 0, percent >= 0.985 ? 1 : percent);
    await db.chapterProgress.put({
      bookId: book.id, chapterId: chapter.id, percent: best, lastReadAt: now,
      finishedAt: best >= 1 ? prev?.finishedAt ?? now : undefined, ...stamp(),
    });
    const all = await db.chapterProgress.where('bookId').equals(book.id).toArray();
    const progress = bookProgress(chapters, all);
    await db.positions.put({ bookId: book.id, chapterId: chapter.id, locator, percent: progress, ...stamp() });
    await db.books.update(book.id, {
      progress, lastReadAt: now, status: progress >= 0.995 ? 'finished' : 'reading', ...stamp(),
    });
    await queue('chapterProgress', `${book.id}|${chapter.id}`);
    await queue('positions', `${book.id}|${deviceId()}`);
    await queue('books', book.id);
    return progress;
  });
}

export async function markChapter(book: Book, chapters: Chapter[], chapter: Chapter, read: boolean): Promise<void> {
  const now = Date.now();
  await db.chapterProgress.put({
    bookId: book.id, chapterId: chapter.id, percent: read ? 1 : 0, lastReadAt: now, finishedAt: read ? now : undefined, ...stamp(),
  });
  const all = await db.chapterProgress.where('bookId').equals(book.id).toArray();
  const progress = bookProgress(chapters, all);
  await db.books.update(book.id, { progress, status: progress >= 0.995 ? 'finished' : progress > 0 ? 'reading' : 'new', ...stamp() });
  await queue('chapterProgress', `${book.id}|${chapter.id}`);
  await queue('books', book.id);
}

/** Самая свежая позиция по книге среди всех устройств. */
export async function latestPosition(bookId: string): Promise<{ locator: Locator; deviceId: string; updatedAt: number } | null> {
  const all = await db.positions.where('bookId').equals(bookId).toArray();
  const best = all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return best ? { locator: best.locator, deviceId: best.deviceId, updatedAt: best.updatedAt } : null;
}

export async function logSession(bookId: string, startedAt: number, endedAt: number, chars: number): Promise<void> {
  if (endedAt - startedAt < 15_000 || chars <= 0) return;
  const id = uid();
  await db.sessions.put({ id, bookId, startedAt, endedAt, charsRead: Math.round(chars), pagesRead: Math.round(chars / 1800), ...stamp() });
  await queue('sessions', id);
}

export async function addHighlight(
  book: Book, chapter: Chapter, range: { start: number; end: number; text: string }, color: HighlightColor,
): Promise<Highlight> {
  const h: Highlight = {
    id: uid(), bookId: book.id, chapterId: chapter.id, chapter: chapter.order,
    start: range.start, end: range.end, text: range.text.slice(0, 4000), color, createdAt: Date.now(), ...stamp(),
  };
  await db.highlights.put(h);
  await queue('highlights', h.id);
  return h;
}

export async function removeHighlight(id: string): Promise<void> {
  await db.highlights.update(id, { deleted: 1, ...stamp() });
  await queue('highlights', id);
}

export const parseTags = (md: string): string[] =>
  [...new Set((md.match(/(?:^|\s)#([\p{L}\d_-]{2,30})/gu) ?? []).map((t) => t.trim().slice(1).toLowerCase()))];

export async function addNote(input: {
  kind: NoteKind; bodyMd: string; bookId?: string | null; chapter?: Chapter; locator?: Locator; highlightId?: string;
}): Promise<Note> {
  const page = input.chapter && input.locator
    ? (input.chapter.endPage > input.chapter.startPage && input.chapter.lengthChars
        ? input.chapter.startPage + Math.floor((input.locator.offset / input.chapter.lengthChars) * (input.chapter.endPage - input.chapter.startPage + 1))
        : pageOfChar(input.chapter.start + input.locator.offset))
    : undefined;
  const note: Note = {
    id: uid(), bookId: input.bookId ?? null, chapterId: input.chapter?.id, highlightId: input.highlightId,
    kind: input.kind, bodyMd: input.bodyMd.trim(), tags: parseTags(input.bodyMd), page,
    locator: input.locator, createdAt: Date.now(), ...stamp(),
  };
  await db.notes.put(note);
  await queue('notes', note.id);
  return note;
}

export async function updateNote(id: string, bodyMd: string): Promise<void> {
  await db.notes.update(id, { bodyMd: bodyMd.trim(), tags: parseTags(bodyMd), ...stamp() });
  await queue('notes', id);
}

export async function deleteNote(id: string): Promise<void> {
  await db.notes.update(id, { deleted: 1, ...stamp() });
  await queue('notes', id);
}

export async function addFlashcard(front: string, back: string, bookId: string | null, noteId: string | null = null): Promise<Flashcard> {
  const card: Flashcard = { id: uid(), noteId, bookId, front, back, ...SM2_INITIAL, dueAt: Date.now(), ...stamp() };
  await db.flashcards.put(card);
  await queue('flashcards', card.id);
  return card;
}

export async function reviewFlashcard(card: Flashcard, grade: number): Promise<void> {
  await db.flashcards.update(card.id, { ...sm2(card, grade), ...stamp() });
  await queue('flashcards', card.id);
}

export async function addBookmark(bookId: string, locator: Locator, label: string): Promise<void> {
  const id = uid();
  await db.bookmarks.put({ id, bookId, locator, label, createdAt: Date.now(), ...stamp() });
  await queue('bookmarks', id);
}

export async function removeBookmark(id: string): Promise<void> {
  await db.bookmarks.update(id, { deleted: 1, ...stamp() });
  await queue('bookmarks', id);
}
