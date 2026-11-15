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
let cache: { key: string; index: SearchIndex<Ref> } | null = null;

export function pageFor(chapter: Chapter, offset: number): number {
  if (chapter.endPage > chapter.startPage && chapter.lengthChars) {
    return Math.min(chapter.endPage, chapter.startPage + Math.floor((offset / chapter.lengthChars) * (chapter.endPage - chapter.startPage + 1)));
  }
  return pageOfChar(chapter.start + offset);
}

/** Индекс по всем книгам и заметкам. Пересобирается, когда меняется состав библиотеки. */
async function getIndex(): Promise<SearchIndex<Ref>> {
  const [books, notes, contentCount] = await Promise.all([db.books.toArray(), db.notes.toArray(), db.contents.count()]);
  const liveNotes = notes.filter((n) => !n.deleted);
  const key = `${contentCount}:${liveNotes.length}:${liveNotes.reduce((m, n) => Math.max(m, n.updatedAt), 0)}`;
  if (cache?.key === key) return cache.index;
  const titles = new Map(books.filter((b) => !b.deleted).map((b) => [b.id, b.title]));
  const chapters = new Map((await db.chapters.toArray()).map((c) => [c.id, c]));
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
  for (const n of liveNotes) {
    const chapter = n.chapterId ? chapters.get(n.chapterId) : undefined;
    items.push({
      text: n.bodyMd,
      ref: {
        kind: 'note', bookId: n.bookId, bookTitle: (n.bookId && titles.get(n.bookId)) || 'Заметка без книги',
        chapter: n.locator?.chapter ?? chapter?.order ?? 0, chapterTitle: chapter?.title ?? '',
        offset: n.locator?.offset ?? 0, page: n.page, text: n.bodyMd,
      },
    });
  }
  const index = buildIndex(items);
  cache = { key, index };
  return index;
}

export interface RetrieveOptions {
  bookId?: string;
  limit?: number;
  /** «Без спойлеров»: только текст до этой позиции (для книги bookId). */
  upTo?: { chapter: number; offset: number };
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<Source[]> {
  const index = await getIndex();
  const hits = searchIndex(index, query, 60)
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
