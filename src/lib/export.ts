import type { Book, Chapter, Note } from './types';

const KIND = { quote: 'Цитата', thought: 'Мысль', ai: 'Ответ ИИ' } as const;

export const safeName = (s: string): string => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Без названия';

/** Заметки одной книги в Markdown, совместимом с Obsidian (frontmatter, цитаты через >, теги, [[ссылки]]). */
export function bookNotesMarkdown(book: Book | null, notes: Note[], chapters: Map<string, Chapter>): string {
  const sorted = [...notes].sort((a, b) => (a.locator?.chapter ?? 0) - (b.locator?.chapter ?? 0) || (a.locator?.offset ?? 0) - (b.locator?.offset ?? 0) || a.createdAt - b.createdAt);
  const tags = [...new Set(sorted.flatMap((n) => n.tags))];
  const head = [
    '---',
    `title: "${(book?.title ?? 'Заметки без книги').replace(/"/g, "'")}"`,
    book?.author ? `author: "${book.author.replace(/"/g, "'")}"` : null,
    'source: ПОЛКА.',
    tags.length ? `tags: [${tags.join(', ')}]` : null,
    '---',
    '',
    `# ${book?.title ?? 'Заметки без книги'}`,
    book?.author ? `*${book.author}*` : null,
    '',
  ].filter((l) => l !== null).join('\n');
  let lastChapter = '';
  const body = sorted.map((n) => {
    const chapter = n.chapterId ? chapters.get(n.chapterId)?.title ?? '' : '';
    const heading = chapter && chapter !== lastChapter ? `\n## ${chapter}\n\n` : '';
    lastChapter = chapter || lastChapter;
    const where = [KIND[n.kind], n.page ? `стр. ${n.page}` : null, new Date(n.createdAt).toISOString().slice(0, 10)].filter(Boolean).join(' · ');
    const text = n.kind === 'quote' ? n.bodyMd.split('\n').map((l) => `> ${l}`).join('\n') : n.bodyMd;
    return `${heading}${text}\n\n<small>${where}</small>\n`;
  }).join('\n');
  return `${head}${body}`;
}

export function download(name: string, data: Blob | string, type = 'text/markdown;charset=utf-8'): void {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
