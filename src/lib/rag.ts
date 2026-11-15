import { db } from './db';
import { pageOfChar } from './progress';
import { buildIndex, chunkText, searchIndex, type SearchIndex } from './search';
import type { Chapter } from './types';

export interface Source {
  n: number;
  kind: 'book' | 'note';
  bookId: string | null;
  bookTitle: string;
  chapter: number;
  chapterTitle: string;
  offset: number;
  page?: number;
  text: string;
}

type Ref = Omit<Source, 'n'>;
// Два отдельных кеша: новая заметка не должна заставлять заново токенизировать все книги.
let bookCache: { key: string; index: SearchIndex<Ref> } | null = null;
let noteCache: { key: string; index: SearchIndex<Ref> } | null = null;

export function pageFor(chapter: Chapter, offset: number): number {
  if (chapter.endPage > chapter.startPage && chapter.lengthChars) {
    return Math.min(chapter.endPage, chapter.startPage + Math.floor((offset / chapter.lengthChars) * (chapter.endPage - chapter.startPage + 1)));
  }
  return pageOfChar(chapter.start + offset);
}

/** Индексы по книгам и по заметкам. Каждый пересобирается, только когда меняется его часть библиотеки. */
async function getIndexes(): Promise<SearchIndex<Ref>[]> {
  const [books, notes, contentCount] = await Promise.all([db.books.toArray(), db.notes.toArray(), db.contents.count()]);
  const liveBooks = books.filter((b) => !b.deleted);
  const liveNotes = notes.filter((n) => !n.deleted);
  const titles = new Map(liveBooks.map((b) => [b.id, b.title]));
  const chapters = new Map((await db.chapters.toArray()).map((c) => [c.id, c]));

  const bookKey = `${contentCount}:${liveBooks.map((b) => b.id).sort().join(',')}`;
  if (bookCache?.key !== bookKey) {
    const items: { text: string; ref: Ref }[] = [];
    await db.contents.each((c) => {
      const bookTitle = titles.get(c.bookId);
      const chapter = chapters.get(`${c.bookId}:${c.order}`);
      if (!bookTitle || !chapter) return;
      for (const piece of chunkText(c.text)) {
        items.push({
          text: piece.text,
          ref: {
            kind: 'book', bookId: c.bookId, bookTitle, chapter: c.order, chapterTitle: chapter.title,
            offset: piece.start, page: pageFor(chapter, piece.start), text: piece.text,
          },
        });
      }
    });
    bookCache = { key: bookKey, index: buildIndex(items) };
  }

  const noteKey = `${liveNotes.length}:${liveNotes.reduce((m, n) => Math.max(m, n.updatedAt), 0)}`;
  if (noteCache?.key !== noteKey) {
    noteCache = {
      key: noteKey,
      index: buildIndex(liveNotes.map((n) => {
        const chapter = n.chapterId ? chapters.get(n.chapterId) : undefined;
        return {
          text: n.bodyMd,
          ref: {
            kind: 'note' as const, bookId: n.bookId, bookTitle: (n.bookId && titles.get(n.bookId)) || 'Заметка без книги',
            chapter: n.locator?.chapter ?? chapter?.order ?? 0, chapterTitle: chapter?.title ?? '',
            offset: n.locator?.offset ?? 0, page: n.page, text: n.bodyMd,
          },
        };
      })),
    };
  }
  return [bookCache.index, noteCache.index];
}

export interface RetrieveOptions {
  bookId?: string;
  limit?: number;
  /** «Без спойлеров»: только текст до этой позиции (для книги bookId). */
  upTo?: { chapter: number; offset: number };
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<Source[]> {
  const hits = (await getIndexes())
    .flatMap((index) => searchIndex(index, query, 60))
    .sort((a, b) => b.score - a.score)
    .map((h) => h.ref)
    .filter((r) => !opts.bookId || r.bookId === opts.bookId)
    .filter((r) => {
      if (!opts.upTo || r.bookId !== opts.bookId) return true;
      return r.chapter < opts.upTo.chapter || (r.chapter === opts.upTo.chapter && r.offset + (r.kind === 'book' ? r.text.length : 0) <= opts.upTo.offset + 400);
    })
    .slice(0, opts.limit ?? 6);
  return hits.map((r, i) => ({ ...r, n: i + 1 }));
}

/** Ссылка на место в книге. q — искомая фраза: читалка подсветит её первое вхождение после смещения. */
export const sourceHref = (s: Pick<Source, 'bookId' | 'chapter' | 'offset'>, q?: string): string =>
  s.bookId ? `/reader?id=${s.bookId}&c=${s.chapter}&o=${s.offset}${q ? `&q=${encodeURIComponent(q.slice(0, 120))}` : ''}` : '/notes';
