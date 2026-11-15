'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { AnswerText } from '@/components/Ask';
import { Markdown } from '@/components/Markdown';
import { addFlashcard, addNote, deleteNote, reviewFlashcard, updateNote } from '@/lib/actions';
import { AiUnavailable, askStream, generate } from '@/lib/ai';
import { db } from '@/lib/db';
import { bookNotesMarkdown, download, safeName } from '@/lib/export';
import { useBooks } from '@/lib/hooks';
import { plural } from '@/lib/progress';
import { tokenize } from '@/lib/search';
import { GRADE_AGAIN, GRADE_GOOD } from '@/lib/sm2';
import type { Chapter, Flashcard, Note, NoteKind } from '@/lib/types';

const KINDS: { key: 'all' | NoteKind; label: string }[] = [
  { key: 'all', label: 'Всё' }, { key: 'quote', label: 'Цитаты' }, { key: 'thought', label: 'Мои мысли' }, { key: 'ai', label: 'Ответы ИИ' },
];
const KIND_LABEL: Record<NoteKind, string> = { quote: 'Цитата', thought: 'Моя мысль', ai: 'Ответ ИИ · сохранён' };
interface Links { themes: { title: string; text: string }[]; contradictions: { title: string; text: string }[] }

export default function NotesPage() {
  const books = useBooks() ?? [];
  const notes = useLiveQuery(async () => (await db.notes.toArray()).filter((n) => !n.deleted).sort((a, b) => b.createdAt - a.createdAt), []) ?? [];
  const chapterList = useLiveQuery(() => db.chapters.toArray(), []) ?? [];
  const cards = useLiveQuery(async () => (await db.flashcards.toArray()).filter((c) => !c.deleted), []) ?? [];
  const links = useLiveQuery(async () => (await db.insights.get('links'))?.content as Links | undefined, []);

  const [kind, setKind] = useState<'all' | NoteKind>('all');
  const [bookId, setBookId] = useState('all');
  const [chapterId, setChapterId] = useState('all');
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [draft, setDraft] = useState('');
  const [aiBusy, setAiBusy] = useState('');
  const [aiError, setAiError] = useState('');
  const [essay, setEssay] = useState<{ title: string; text: string; saved?: boolean } | null>(null);
  const [review, setReview] = useState<{ queue: Flashcard[]; flipped: boolean } | null>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const reviewDlg = useRef<HTMLDialogElement>(null);

  const chapters = useMemo(() => new Map<string, Chapter>(chapterList.map((c) => [c.id, c])), [chapterList]);
  const titles = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);

  const visible = useMemo(() => {
    const terms = tokenize(q);
    return notes.filter((n) => {
      if (kind !== 'all' && n.kind !== kind) return false;
      if (bookId !== 'all' && (n.bookId ?? 'none') !== bookId) return false;
      if (chapterId !== 'all' && n.chapterId !== chapterId) return false;
      if (tag && !n.tags.includes(tag)) return false;
      if (terms.length) {
        const hay = new Set(tokenize(`${n.bodyMd} ${titles.get(n.bookId ?? '')?.title ?? ''}`));
        return terms.every((t) => hay.has(t));
      }
      return true;
    });
  }, [notes, kind, bookId, chapterId, tag, q, titles]);

  const due = cards.filter((c) => c.dueAt <= Date.now());
  const quotesWithoutCards = notes.filter((n) => n.kind === 'quote' && !cards.some((c) => c.noteId === n.id));

  const openEditor = (n: Note | 'new'): void => {
    setEditing(n);
    setDraft(n === 'new' ? '' : n.bodyMd);
    editor.current?.showModal();
  };

  const exportOne = (): void => {
    const groups = groupByBook(notes);
    const md = [...groups].map(([id, list]) => bookNotesMarkdown(titles.get(id) ?? null, list, chapters)).join('\n\n---\n\n');
    download(`polka-zametki-${new Date().toISOString().slice(0, 10)}.md`, md);
  };
  const exportVault = async (): Promise<void> => {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const [id, list] of groupByBook(notes)) {
      const book = titles.get(id) ?? null;
      zip.file(`ПОЛКА/${safeName(book?.title ?? 'Заметки без книги')}.md`, bookNotesMarkdown(book, list, chapters));
    }
    download('polka-obsidian.zip', await zip.generateAsync({ type: 'blob' }), 'application/zip');
  };

  const noteSources = (list: Note[]) => list.slice(0, 12).map((n, i) => ({
    n: i + 1, kind: 'note' as const, bookTitle: titles.get(n.bookId ?? '')?.title ?? 'Без книги',
    chapterTitle: n.chapterId ? chapters.get(n.chapterId)?.title ?? '' : '', page: n.page, text: n.bodyMd,
  }));

  const findLinks = async (): Promise<void> => {
    setAiBusy('links');
    setAiError('');
    try {
      const payload = notes.slice(0, 80).map((n) => `[${KIND_LABEL[n.kind]} · ${titles.get(n.bookId ?? '')?.title ?? 'без книги'}] ${n.bodyMd.slice(0, 500)}`).join('\n\n');
      const { data, model } = await generate<Links>({ kind: 'links', notes: payload });
      await db.insights.put({ key: 'links', bookId: '', section: 'summary', content: data, model, createdAt: Date.now() });
    } catch (e) {
      setAiError(e instanceof AiUnavailable ? 'ИИ не подключён: на сервере нет ключа. Связи между заметками ищет только ИИ.' : e instanceof Error ? e.message : 'Ошибка');
    }
    setAiBusy('');
  };

  const compose = async (title: string, question: string, mode: 'essay' | 'debate'): Promise<void> => {
    setAiBusy(title);
    setAiError('');
    setEssay({ title, text: '' });
    let text = '';
    try {
      await askStream({ question, mode, sources: noteSources(notes) }, (chunk) => {
        text += chunk;
        setEssay({ title, text });
      });
    } catch (e) {
      setEssay(null);
      setAiError(e instanceof AiUnavailable ? 'ИИ не подключён: на сервере нет ключа.' : e instanceof Error ? e.message : 'Ошибка');
    }
    setAiBusy('');
  };

  const startReview = async (): Promise<void> => {
    for (const n of quotesWithoutCards) {
      const book = titles.get(n.bookId ?? '');
      const where = [book?.title, n.chapterId ? chapters.get(n.chapterId)?.title : null, n.page ? `стр. ${n.page}` : null].filter(Boolean).join(' · ');
      await addFlashcard(`Откуда эта цитата и почему ты её выделил?\n\n«${n.bodyMd.slice(0, 400)}»`, where || 'Цитата без книги', n.bookId, n.id);
    }
    const queue = (await db.flashcards.toArray()).filter((c) => !c.deleted && c.dueAt <= Date.now()).sort((a, b) => a.dueAt - b.dueAt).slice(0, 30);
    if (!queue.length) return;
    setReview({ queue, flipped: false });
    reviewDlg.current?.showModal();
  };

  const grade = (g: number): void => {
    if (!review) return;
    const [card, ...rest] = review.queue;
    if (card) void reviewFlashcard(card, g);
    if (rest.length) setReview({ queue: rest, flipped: false });
    else {
      setReview(null);
      reviewDlg.current?.close();
    }
  };

  const dueCount = due.length + quotesWithoutCards.length;

  return (
    <div className="page pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <h1 className="display" style={{ fontSize: 'var(--fs-h1)' }}>Поля<span className="dot">.</span></h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="pill pill-accent" onClick={() => openEditor('new')}>+ Заметка</button>
          <button type="button" className="pill" disabled={!notes.length} onClick={exportOne}>Экспорт в Markdown</button>
          <button type="button" className="pill" disabled={!notes.length} onClick={() => void exportVault()}>В Obsidian (zip)</button>
          <button type="button" className="pill" disabled={!notes.length} onClick={() => window.print()}>PDF-конспект</button>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2 print:hidden">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Тип заметок">
          {KINDS.map((k) => (
            <button key={k.key} type="button" className="pill" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>
              {k.label}{k.key === 'all' && <span className="count">{notes.length}</span>}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="f-book">Книга</label>
        <select id="f-book" className="field" style={{ width: 'auto', maxWidth: 240 }} value={bookId} onChange={(e) => { setBookId(e.target.value); setChapterId('all'); }}>
          <option value="all">Все книги</option>
          {books.filter((b) => notes.some((n) => n.bookId === b.id)).map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          <option value="none">Без книги</option>
        </select>
        {bookId !== 'all' && bookId !== 'none' && (
          <>
            <label className="sr-only" htmlFor="f-ch">Глава</label>
            <select id="f-ch" className="field" style={{ width: 'auto', maxWidth: 240 }} value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
              <option value="all">Все главы</option>
              {chapterList.filter((c) => c.bookId === bookId && notes.some((n) => n.chapterId === c.id)).sort((a, b) => a.order - b.order)
                .map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </>
        )}
        <label className="sr-only" htmlFor="f-q">Поиск по заметкам</label>
        <input id="f-q" className="field" style={{ width: 220, flex: '1 1 180px', maxWidth: 360 }} placeholder="Поиск по заметкам" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1 print:hidden" role="group" aria-label="Теги">
          {tags.map((t) => <button key={t} type="button" className="tablink" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>#{t}</button>)}
        </div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <section aria-label="Заметки" className="min-w-0">
          {notes.length === 0 ? (
            <div className="border border-dashed border-line-3 p-8">
              <p className="text-[17px]">На полях пока чисто.</p>
              <p className="mt-2 text-text-2">Выдели фразу в книге и нажми «Цитата» — она появится здесь. Или запиши мысль кнопкой «+ Заметка».</p>
            </div>
          ) : visible.length === 0 ? (
            <p className="text-text-2">Под эти фильтры заметок нет.</p>
          ) : (
            <ul style={{ columns: '3 260px', columnGap: 16 }}>
              {visible.map((n) => {
                const book = titles.get(n.bookId ?? '');
                const chapter = n.chapterId ? chapters.get(n.chapterId) : undefined;
                const style: React.CSSProperties = n.kind === 'quote' ? { background: 'var(--text)', color: 'var(--ink)' }
                  : n.kind === 'ai' ? { background: 'var(--accent)', color: 'var(--ink)' } : { border: '1px solid var(--line-3)' };
                const href = book && n.locator ? `/reader?id=${book.id}&c=${n.locator.chapter}&o=${n.locator.offset}` : null;
                return (
                  <li key={n.id} className="mb-4 break-inside-avoid p-5" style={style}>
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ opacity: 0.75 }}>{KIND_LABEL[n.kind]}</p>
                    <div className={`mt-3 ${n.kind === 'quote' ? 'font-book text-[18px] leading-snug' : 'text-[15px]'}`} style={{ overflowWrap: 'anywhere' }}>
                      <Markdown text={n.kind === 'quote' ? `«${n.bodyMd}»` : n.bodyMd} onLink={(t) => setQ(t)} />
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3 text-[13px]">
                      {href ? (
                        <Link href={href} className="font-semibold underline underline-offset-4" aria-label={`Открыть это место в книге «${book?.title}»`}>{book?.title}</Link>
                      ) : <span className="font-semibold">{book?.title ?? 'Без книги'}</span>}
                      <span className="flex-none font-mono text-[11px]">{[chapter?.title.slice(0, 22), n.page ? `стр. ${n.page}` : null].filter(Boolean).join(' · ') || '—'}</span>
                    </div>
                    <div className="mt-2 flex gap-4 print:hidden">
                      <button type="button" className="min-h-[44px] font-mono text-[11px] uppercase tracking-[0.12em] underline underline-offset-4" onClick={() => openEditor(n)}>Изменить</button>
                      <button type="button" className="min-h-[44px] font-mono text-[11px] uppercase tracking-[0.12em] underline underline-offset-4"
                        onClick={() => window.confirm('Удалить заметку? Вернуть её не получится.') && void deleteNote(n.id)}>Удалить</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="min-w-0 print:hidden">
          <h2 className="mono"><span className="dot">●</span> ИИ нашёл связи</h2>
          {!links && (
            <p className="mt-3 text-[14px] text-text-2">
              {notes.length < 3 ? 'Связи появятся, когда наберётся хотя бы три заметки.' : 'ИИ сопоставит твои заметки: общие темы между книгами и места, где ты споришь сам с собой.'}
            </p>
          )}
          {links?.themes.map((t, i) => (
            <div key={`t${i}`} className="mt-4 border border-line p-4">
              <h3 className="font-semibold">{t.title}</h3>
              <p className="mt-2 text-[14px] text-text-2">{t.text}</p>
              <button type="button" className="pill pill-sm mt-3" disabled={!!aiBusy}
                onClick={() => void compose(t.title, `Собери эссе-черновик на тему «${t.title}». ${t.text}`, 'essay')}>Собрать эссе-черновик</button>
            </div>
          ))}
          {links?.contradictions.map((t, i) => (
            <div key={`c${i}`} className="mt-4 border border-line p-4">
              <p className="mono">Противоречие</p>
              <h3 className="mt-1 font-semibold">{t.title}</h3>
              <p className="mt-2 text-[14px] text-text-2">{t.text}</p>
              <button type="button" className="pill pill-sm mt-3" disabled={!!aiBusy}
                onClick={() => void compose(`Спор: ${t.title}`, `Поспорь со мной: ${t.text}`, 'debate')}>Поспорить с ИИ</button>
            </div>
          ))}
          <button type="button" className="pill pill-sm mt-4" disabled={notes.length < 3 || !!aiBusy} onClick={() => void findLinks()}>
            {aiBusy === 'links' ? 'Ищу связи…' : links ? 'Найти заново' : 'Найти связи'}
          </button>
          {aiError && <p className="mt-3 text-[14px]" role="alert" style={{ color: 'var(--danger)' }}>{aiError}</p>}
          {essay && (
            <div className="mt-4 border border-line p-4" aria-live="polite">
              <h3 className="font-semibold">{essay.title}</h3>
              <div className="mt-2 text-[14px]"><AnswerText text={essay.text || 'Пишу…'} sources={[]} /></div>
              {!aiBusy && essay.text && (
                <button type="button" className="pill pill-sm mt-3" disabled={essay.saved} onClick={() => {
                  void addNote({ kind: 'ai', bodyMd: `**${essay.title}**\n\n${essay.text}` });
                  setEssay({ ...essay, saved: true });
                }}>{essay.saved ? 'Сохранено в заметки' : 'Сохранить в заметки'}</button>
              )}
            </div>
          )}

          <div className="mt-8 p-5" style={{ background: 'var(--surface)' }}>
            <h2 className="font-semibold">Повторить сегодня</h2>
            <p className="mt-1 text-[14px] text-text-2">
              {dueCount > 0
                ? `${dueCount} ${plural(dueCount, ['карточка', 'карточки', 'карточек'])} из твоих выделений`
                : cards.length ? 'На сегодня всё повторено.' : 'Карточки появятся из сохранённых цитат.'}
            </p>
            <button type="button" className="pill pill-sm pill-accent mt-3" disabled={dueCount === 0} onClick={() => void startReview()}>Начать</button>
          </div>
        </aside>
      </div>

      <dialog ref={editor} aria-label={editing === 'new' ? 'Новая заметка' : 'Изменить заметку'}
        className="w-full max-w-[640px] border border-line-2 bg-bg-2 p-6 text-text backdrop:bg-black/60" onClose={() => setEditing(null)}>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          if (editing === 'new') void addNote({ kind: 'thought', bodyMd: draft });
          else if (editing) void updateNote(editing.id, draft);
          editor.current?.close();
        }}>
          <label htmlFor="note-body" className="font-display text-[20px] font-semibold">{editing === 'new' ? 'Новая заметка' : 'Изменить заметку'}</label>
          <textarea id="note-body" className="field mt-4 font-mono text-[14px]" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
            placeholder="Markdown: **жирный**, *курсив*, #тег, [[ссылка на другую заметку]]" />
          {draft.trim() && (
            <div className="mt-3 border border-line p-4 text-[15px]" aria-label="Предпросмотр"><Markdown text={draft} /></div>
          )}
          <div className="mt-5 flex gap-2">
            <button type="submit" className="pill pill-accent" disabled={!draft.trim()}>Сохранить</button>
            <button type="button" className="pill" onClick={() => editor.current?.close()}>Отмена</button>
          </div>
        </form>
      </dialog>

      <dialog ref={reviewDlg} aria-label="Повторение карточек" className="w-full max-w-[560px] border border-line-2 bg-bg-2 p-6 text-text backdrop:bg-black/60" onClose={() => setReview(null)}>
        {review?.queue[0] && (
          <div aria-live="polite">
            <p className="mono">Осталось: {review.queue.length}</p>
            <p className="mt-4 whitespace-pre-wrap font-book text-[19px] leading-snug">{review.queue[0].front}</p>
            {review.flipped ? (
              <>
                <p className="mt-5 border-t border-line pt-5 whitespace-pre-wrap text-[16px]" style={{ color: 'var(--accent)' }}>{review.queue[0].back}</p>
                <div className="mt-6 flex gap-2">
                  <button type="button" className="pill" onClick={() => grade(GRADE_AGAIN)}>Ещё раз</button>
                  <button type="button" className="pill pill-accent" autoFocus onClick={() => grade(GRADE_GOOD)}>Помню</button>
                </div>
              </>
            ) : (
              <button type="button" className="pill pill-accent mt-6" autoFocus onClick={() => setReview({ ...review, flipped: true })}>Показать ответ</button>
            )}
          </div>
        )}
        <button type="button" className="pill pill-sm mt-6" onClick={() => reviewDlg.current?.close()}>Закончить</button>
      </dialog>
    </div>
  );
}

function groupByBook(notes: Note[]): Map<string, Note[]> {
  const out = new Map<string, Note[]>();
  for (const n of notes) {
    const key = n.bookId ?? '';
    out.set(key, [...(out.get(key) ?? []), n]);
  }
  return out;
}
