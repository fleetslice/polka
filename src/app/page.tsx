'use client';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { AnswerBlock, useAsk } from '@/components/Ask';
import { ShelfTabs } from '@/components/home/ShelfTabs';
import { Covers, Spines } from '@/components/home/Spines';
import { useBooks, useDevices, useShelves } from '@/lib/hooks';
import { importFiles } from '@/lib/import';
import { plural, relativeDay } from '@/lib/progress';
import { retrieve } from '@/lib/rag';
import { useSettings, type SortKey } from '@/lib/settings';
import type { Book } from '@/lib/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Недавние' },
  { key: 'author', label: 'По автору' },
  { key: 'title', label: 'По названию' },
  { key: 'progress', label: 'По прогрессу' },
  { key: 'added', label: 'По дате добавления' },
];

function sortBooks(books: Book[], key: SortKey): Book[] {
  const list = [...books];
  const ru = (a: string, b: string): number => a.localeCompare(b, 'ru');
  switch (key) {
    case 'author': return list.sort((a, b) => ru(a.author.split(' ').pop() ?? '', b.author.split(' ').pop() ?? '') || ru(a.title, b.title));
    case 'title': return list.sort((a, b) => ru(a.title, b.title));
    case 'progress': return list.sort((a, b) => b.progress - a.progress);
    case 'added': return list.sort((a, b) => b.createdAt - a.createdAt);
    default: return list.sort((a, b) => (b.lastReadAt ?? b.createdAt) - (a.lastReadAt ?? a.createdAt));
  }
}

function Continue({ books }: { books: Book[] }) {
  const devices = useDevices();
  const reading = books.filter((b) => b.lastReadAt && b.progress < 0.995).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)).slice(0, 3);
  const info = useLiveQuery(async () => {
    const out: Record<string, { line: string; device: string }> = {};
    for (const b of reading) {
      const pos = (await db.positions.where('bookId').equals(b.id).toArray()).sort((x, y) => y.updatedAt - x.updatedAt)[0];
      const chapter = pos ? await db.chapters.get(pos.chapterId) : undefined;
      const page = Math.max(1, Math.round(b.progress * b.pages));
      out[b.id] = {
        line: [chapter?.title, b.kind === 'audio' ? null : `стр. ${page} из ${b.pages}`, relativeDay(b.lastReadAt)].filter(Boolean).join(' · '),
        device: pos?.deviceId ?? '',
      };
    }
    return out;
  }, [reading.map((b) => `${b.id}:${b.lastReadAt}`).join(',')]);
  if (!reading.length) return null;
  return (
    <section aria-labelledby="continue-h" className="mt-14">
      <h2 id="continue-h" className="sr-only">Продолжить чтение</h2>
      <div className="hairgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {reading.map((b, i) => {
          const device = devices?.find((d) => d.id === info?.[b.id]?.device)?.name ?? 'это устройство';
          return (
            <Link key={b.id} href={`/reader?id=${b.id}`} className="block p-6 no-underline hover:!bg-bg-2">
              <span className="flex justify-between"><span className="mono">Продолжить · {device}</span><span className="mono">{b.format}</span></span>
              <span className="display mt-3 block" style={{ fontSize: 'var(--fs-num)', color: i === 0 ? 'var(--accent)' : 'var(--text)' }}>
                {Math.round(b.progress * 100)}%
              </span>
              <span className="bar mt-3 block" aria-hidden><i style={{ width: `${Math.round(b.progress * 100)}%`, background: i === 0 ? 'var(--accent)' : 'var(--text)' }} /></span>
              <span className="mt-4 block text-[17px] font-semibold">{b.title}</span>
              <span className="mt-1 block text-[13px] text-muted">{info?.[b.id]?.line ?? relativeDay(b.lastReadAt)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function AskLibrary() {
  const { answer, ask } = useAsk();
  const [q, setQ] = useState('');
  return (
    <section aria-labelledby="ask-h" className="mt-16">
      <h2 id="ask-h" className="mono">Спроси свою библиотеку</h2>
      <form
        className="mt-3 flex items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const question = q.trim();
          if (question) void retrieve(question, { limit: 6 }).then((sources) => ask(question, sources, { mode: 'library' }));
        }}
      >
        <label htmlFor="ask" className="sr-only">Вопрос к своим книгам и заметкам</label>
        <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Что мои книги говорят о…"
          className="field-underline font-display font-semibold" style={{ fontSize: 'clamp(20px, 3.2vw, 40px)', letterSpacing: '-0.02em' }} autoComplete="off" />
        <button type="submit" className="icon-btn icon-btn-accent" style={{ width: 56, height: 56 }} aria-label="Спросить">
          <ArrowRight size={22} strokeWidth={2} aria-hidden />
        </button>
      </form>
      <p className="mt-3 text-[13px] text-muted">Ответ собирается только из твоих книг и заметок — с номером страницы.</p>
      {answer && <AnswerBlock answer={answer} />}
    </section>
  );
}

/** Телефон: баннер «с другого устройства» и крупный процент текущей книги. */
function PhoneNow({ book }: { book: Book }) {
  const devices = useDevices();
  const pos = useLiveQuery(async () => (await db.positions.where('bookId').equals(book.id).toArray()).sort((a, b) => b.updatedAt - a.updatedAt)[0], [book.id, book.lastReadAt]);
  const mine = typeof localStorage !== 'undefined' ? localStorage.getItem('polka.device') : null;
  const other = pos && pos.deviceId !== mine ? devices?.find((d) => d.id === pos.deviceId) : undefined;
  const page = Math.max(1, Math.round(book.progress * book.pages));
  return (
    <section className="md:hidden" aria-label="Сейчас читаю">
      {other && pos && (
        <Link href={`/reader?id=${book.id}`} className="-mx-[var(--gutter)] block px-[var(--gutter)] py-4 no-underline" style={{ background: 'var(--accent)', color: 'var(--ink)' }}>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">С устройства «{other.name}» · {relativeDay(pos.updatedAt)}</span>
          <span className="mt-1 block text-[17px] font-semibold">Продолжить «{book.title}» со стр. {page} →</span>
        </Link>
      )}
      <Link href={`/reader?id=${book.id}`} className="block pt-8 no-underline">
        <span className="mono">Сейчас читаю</span>
        <span className="display block text-[96px]">{Math.round(book.progress * 100)}<span className="dot">%</span></span>
        <span className="block text-[20px] font-semibold">{book.title}</span>
        <span className="block text-[13px] text-muted">{[book.author, book.format.toUpperCase(), `стр. ${page} из ${book.pages}`].filter(Boolean).join(' · ')}</span>
      </Link>
    </section>
  );
}

export default function ShelfPage() {
  const router = useRouter();
  const books = useBooks();
  const shelves = useShelves();
  const { shelfView, sort, set } = useSettings();
  const [shelf, setShelf] = useState('all');
  const [format, setFormat] = useState('all');
  const picker = useRef<HTMLInputElement>(null);

  const formats = useMemo(() => [...new Set((books ?? []).map((b) => b.format))].sort(), [books]);
  const visible = useMemo(() => {
    const list = (books ?? []).filter((b) => (shelf === 'all' || b.shelfId === shelf) && (format === 'all' || b.format === format));
    return sortBooks(list, sort);
  }, [books, shelf, format, sort]);
  const current = useMemo(() => (books ?? []).filter((b) => b.lastReadAt && b.progress < 0.995).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0], [books]);

  const add = (): void => picker.current?.click();
  const n = books?.length ?? 0;

  return (
    <div className="page">
      <input ref={picker} type="file" multiple className="hidden" aria-hidden tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          router.push('/cloud#queue');
          void importFiles(files, { shelfId: shelf === 'all' ? null : shelf });
        }} />

      {current && <PhoneNow book={current} />}

      <section className={`grid items-end gap-8 pt-10 lg:grid-cols-[1fr_minmax(260px,340px)] ${current ? 'hidden md:grid' : ''}`}>
        <div>
          <p className="mono">Личная библиотека · {books ? `${n} ${plural(n, ['книга', 'книги', 'книг'])}` : '…'}</p>
          <h1 className="display mt-4" style={{ fontSize: 'var(--fs-hero)' }}>
            Всё, что<br />я читаю<span className="dot">.</span>
          </h1>
        </div>
        <p className="pb-3 text-[17px] leading-relaxed text-text-2">
          Любой формат — от EPUB до PDF. Свои полки, заметки на полях и ИИ, который объясняет прочитанное и спорит с тобой о нём.
        </p>
      </section>

      {books && n === 0 ? (
        <section className="mt-12 border border-dashed border-line-3 p-8 md:p-12" aria-labelledby="empty-h">
          <h2 id="empty-h" className="display text-[clamp(26px,4vw,44px)]">На полке пока пусто<span className="dot">.</span></h2>
          <p className="mt-4 max-w-[560px] text-[17px] text-text-2">
            Закинь первую книгу — EPUB, FB2, PDF, DOCX, TXT или другой формат. Файл останется на этом устройстве, в памяти браузера.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="pill pill-accent" onClick={add}>Выбрать файлы</button>
            <Link href="/cloud" className="pill">Перетащить папку целиком</Link>
          </div>
        </section>
      ) : (
        <>
          <div className="mt-10 flex flex-wrap items-start justify-between gap-4">
            <ShelfTabs shelves={shelves ?? []} books={books ?? []} active={shelf} onSelect={setShelf} />
            <div className="flex rounded-pill border border-line-3 p-[3px]" role="group" aria-label="Вид полки">
              {(['spines', 'covers'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={shelfView === v} onClick={() => set('shelfView', v)}
                  className="rounded-pill px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.12em]"
                  style={{ minHeight: 38, background: shelfView === v ? 'var(--text)' : 'transparent', color: shelfView === v ? 'var(--bg)' : 'var(--text-2)' }}>
                  {v === 'spines' ? 'Корешки' : 'Обложки'}
                </button>
              ))}
            </div>
          </div>

          <section aria-label="Книги на полке" className="mt-8">
            {visible.length === 0 ? (
              <p className="border border-dashed border-line-3 p-8 text-text-2">
                {shelf !== 'all' && format === 'all' ? 'На этой полке пока пусто — закинь сюда книгу или перенеси с другой полки.' : 'Под этот фильтр книг нет.'}
              </p>
            ) : shelfView === 'spines' ? <Spines books={visible} onAdd={add} /> : <Covers books={visible} />}
          </section>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap" role="group" aria-label="Фильтр по формату">
              <button type="button" className="tablink" aria-pressed={format === 'all'} onClick={() => setFormat('all')}>Все</button>
              {formats.map((f) => (
                <button key={f} type="button" className="tablink" aria-pressed={format === f} onClick={() => setFormat(f)}>{f}</button>
              ))}
            </div>
            <label className="mono flex items-center gap-2">
              Сортировка
              <select value={sort} onChange={(e) => set('sort', e.target.value as SortKey)} className="field" style={{ width: 'auto', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text)' }}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>

          <Continue books={books ?? []} />
          <AskLibrary />
        </>
      )}
    </div>
  );
}
