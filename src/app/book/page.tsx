'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { AnswerBlock, useAsk } from '@/components/Ask';
import { inkOn } from '@/components/home/Spines';
import { chapterRows, type ChapterRow } from '@/components/reader/model';
import { SegmentBar } from '@/components/reader/SegmentBar';
import { addFlashcard, deleteBook, moveBook, reviewFlashcard } from '@/lib/actions';
import { AiUnavailable, generate, type BookInsight } from '@/lib/ai';
import { db } from '@/lib/db';
import { download } from '@/lib/export';
import { lastBook, useBook, useBooks, useShelves } from '@/lib/hooks';
import { formatSize, plural, relativeDay } from '@/lib/progress';
import { retrieve } from '@/lib/rag';
import { GRADE_AGAIN, GRADE_GOOD } from '@/lib/sm2';
import type { Book, Chapter, Flashcard } from '@/lib/types';

const TABS = [['summary', 'Суть'], ['characters', 'Персонажи'], ['context', 'Контекст эпохи'], ['debates', 'Спорные места'], ['cards', 'Карточки']] as const;
type Tab = (typeof TABS)[number][0];

/** Выдержки для толкования: начало каждой главы, пока не наберётся лимит. */
async function excerpts(bookId: string, chapters: Chapter[]): Promise<string> {
  const per = Math.max(600, Math.min(4000, Math.floor(100_000 / Math.max(1, chapters.length))));
  let out = '';
  for (const c of chapters) {
    const content = await db.contents.get([bookId, c.order]);
    if (content?.text.trim()) out += `### ${c.title}\n${content.text.slice(0, per)}\n\n`;
  }
  return out;
}

function Insight({ book, chapters }: { book: Book; chapters: Chapter[] }) {
  const key = `${book.id}:book`;
  const cached = useLiveQuery(async () => (await db.insights.get(key)) ?? null, [key]);
  const cards = useLiveQuery(async () => (await db.flashcards.where('bookId').equals(book.id).toArray()).filter((c) => !c.deleted && !c.noteId), [book.id]) ?? [];
  const [tab, setTab] = useState<Tab>('summary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [flipped, setFlipped] = useState<string | null>(null);
  const data = cached?.content as BookInsight | undefined;

  const run = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const res = await generate<BookInsight>({ kind: 'book', title: book.title, author: book.author, excerpts: await excerpts(book.id, chapters) });
      await db.insights.put({ key, bookId: book.id, section: 'summary', content: res.data, model: res.model, createdAt: Date.now() });
      const old = (await db.flashcards.where('bookId').equals(book.id).toArray()).filter((c) => !c.noteId);
      if (!old.length) for (const c of res.data.cards ?? []) await addFlashcard(c.front, c.back, book.id);
    } catch (e) {
      setError(e instanceof AiUnavailable ? '' : e instanceof Error ? e.message : 'Ошибка');
      if (e instanceof AiUnavailable) setAiReady(false);
    }
    setBusy(false);
  };

  // Толкование готовится один раз — при первом открытии страницы книги, если ИИ подключён.
  useEffect(() => {
    if (cached !== undefined && !cached && book.kind === 'text' && aiReady === null) {
      void fetch('/api/ai/status').then((r) => r.json()).then((s: { ai: boolean }) => {
        setAiReady(s.ai);
        if (s.ai) void run();
      }).catch(() => setAiReady(false));
    }
  }, [cached]); // eslint-disable-line react-hooks/exhaustive-deps

  if (book.kind !== 'text') {
    return <p className="mt-4 text-text-2">У этой книги нет текстового слоя, поэтому ИИ-толкование для неё недоступно.</p>;
  }
  if (!data) {
    return (
      <div className="mt-4" aria-live="polite">
        {busy ? <p className="display text-[clamp(22px,3vw,36px)]">ИИ читает книгу и готовит толкование…</p> : aiReady === false ? (
          <>
            <p className="display text-[clamp(22px,3vw,36px)]">ИИ не подключён<span className="dot">.</span></p>
            <p className="mt-3 max-w-[560px] text-text-2">Чтобы появились суть книги, персонажи, контекст эпохи и карточки, задай на сервере ключ ANTHROPIC_API_KEY (см. README). Чтение, прогресс и заметки работают и без него.</p>
          </>
        ) : <p className="mono">Проверяю ИИ…</p>}
        {error && <p className="mt-3" role="alert" style={{ color: 'var(--danger)' }}>{error} <button type="button" className="underline" onClick={() => void run()}>Повторить</button></p>}
      </div>
    );
  }

  return (
    <div>
      <h2 className="display mt-3" style={{ fontSize: 'clamp(28px, 4.4vw, 60px)', lineHeight: 1 }}>{data.oneLiner}</h2>
      <div role="tablist" aria-label="Разделы толкования" className="mt-6 flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" id={`t-${k}`} aria-controls="insight-panel" aria-selected={tab === k} className="pill pill-sm" onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id="insight-panel" aria-labelledby={`t-${tab}`} className="mt-6">
        {tab === 'summary' && (
          <>
            <p className="max-w-[720px] text-[17px] leading-relaxed text-text-2">{data.summary}</p>
            <ol className="hairgrid mt-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              {data.ideas?.map((idea, i) => (
                <li key={i} className="p-5">
                  <span className="mono" style={{ color: 'var(--accent)' }}>{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="mt-2 font-semibold">{idea.title}</h3>
                  <p className="mt-1 text-[14px] text-text-2">{idea.text}</p>
                </li>
              ))}
            </ol>
          </>
        )}
        {tab === 'characters' && (
          <dl className="max-w-[720px]">
            {data.characters?.map((c, i) => (
              <div key={i} className="grid gap-x-6 border-b border-line py-3 sm:grid-cols-[200px_1fr]">
                <dt className="font-semibold">{c.name}</dt><dd className="text-text-2">{c.role}</dd>
              </div>
            ))}
          </dl>
        )}
        {tab === 'context' && (
          <ol className="max-w-[720px] border-l border-line-3 pl-6">
            {data.context?.map((c, i) => (
              <li key={i} className="relative pb-6">
                <i aria-hidden className="absolute -left-[29px] top-[6px] h-[9px] w-[9px] rounded-full" style={{ background: 'var(--accent)' }} />
                <p className="mono" style={{ color: 'var(--text)' }}>{c.date}</p>
                <p className="mt-1 text-text-2">{c.text}</p>
              </li>
            ))}
          </ol>
        )}
        {tab === 'debates' && (
          <div className="max-w-[820px]">
            {data.debates?.map((d, i) => (
              <section key={i} className="border-b border-line py-5">
                <h3 className="text-[17px] font-semibold">{d.question}</h3>
                <ul className="mt-3 grid gap-4 sm:grid-cols-2">
                  {d.readings?.map((r, j) => <li key={j} className="text-[14px] text-text-2"><span className="mono block">Трактовка {j + 1}</span>{r}</li>)}
                </ul>
              </section>
            ))}
            <p className="mt-4 text-[13px] text-muted">ИИ показывает трактовки и не выбирает за тебя.</p>
          </div>
        )}
        {tab === 'cards' && (
          <ul className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {cards.length === 0 && <li className="text-text-2">Карточек к этой книге нет.</li>}
            {cards.map((c: Flashcard) => {
              const open = flipped === c.id;
              return (
                <li key={c.id} className="flex min-h-[180px] flex-col border border-line-3 p-4" style={open ? { background: 'var(--surface)' } : undefined}>
                  <button type="button" className="flex-1 text-left" aria-expanded={open} onClick={() => setFlipped(open ? null : c.id)}>
                    <span className="mono block">{open ? 'Ответ' : 'Вопрос'} · {c.dueAt <= Date.now() ? 'пора повторить' : `через ${Math.max(1, Math.ceil((c.dueAt - Date.now()) / 86_400_000))} дн.`}</span>
                    <span className="mt-2 block">{open ? c.back : c.front}</span>
                  </button>
                  {open && (
                    <div className="mt-3 flex gap-2">
                      <button type="button" className="pill pill-sm" onClick={() => { void reviewFlashcard(c, GRADE_AGAIN); setFlipped(null); }}>Ещё раз</button>
                      <button type="button" className="pill pill-sm pill-accent" onClick={() => { void reviewFlashcard(c, GRADE_GOOD); setFlipped(null); }}>Помню</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-muted">
        Подготовлено {relativeDay(cached?.createdAt)} · {cached?.model}
        <button type="button" className="pill pill-sm" disabled={busy} onClick={() => void run()}>{busy ? 'Готовлю заново…' : 'Перегенерировать'}</button>
      </p>
      {error && <p className="mt-2" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}

function ChapterMap({ book, chapters, rows }: { book: Book; chapters: Chapter[]; rows: ChapterRow[] }) {
  const router = useRouter();
  const progress = useLiveQuery(() => db.chapterProgress.where('bookId').equals(book.id).toArray(), [book.id]) ?? [];
  const notes = useLiveQuery(async () => (await db.notes.where('bookId').equals(book.id).toArray()).filter((n) => !n.deleted), [book.id]) ?? [];
  const recaps = useLiveQuery(async () => new Map((await db.insights.where('bookId').equals(book.id).toArray()).filter((i) => i.section === 'chapter_recap').map((i) => [i.chapterId!, (i.content as { recap: string }).recap])), [book.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const recap = async (c: Chapter): Promise<void> => {
    setBusy(c.id);
    setError('');
    try {
      const content = await db.contents.get([book.id, c.order]);
      const res = await generate<{ recap: string }>({ kind: 'recap', title: book.title, chapterTitle: c.title, text: content?.text ?? '' });
      await db.insights.put({ key: `${book.id}:recap:${c.id}`, bookId: book.id, chapterId: c.id, section: 'chapter_recap', content: res.data, model: res.model, createdAt: Date.now() });
    } catch (e) {
      setError(e instanceof AiUnavailable ? 'ИИ не подключён: пересказ главы недоступен.' : e instanceof Error ? e.message : 'Ошибка');
    }
    setBusy(null);
  };

  return (
    <section aria-labelledby="map-h" className="mt-12">
      <h2 id="map-h" className="font-display text-[22px] font-semibold">Карта глав</h2>
      <div className="mt-2"><SegmentBar rows={rows} onGo={(i) => router.push(`/reader?id=${book.id}&c=${i}&o=0`)} label={`${Math.round(book.progress * 100)}%`} /></div>
      {error && <p role="alert" className="mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}
      <ol className="mt-2 border-t border-line">
        {rows.map((r, i) => {
          const p = progress.find((x) => x.chapterId === r.chapter.id);
          const n = notes.filter((x) => x.chapterId === r.chapter.id).length;
          const text = recaps?.get(r.chapter.id);
          return (
            <li key={r.chapter.id} className="border-b border-line py-3" style={{ paddingLeft: r.chapter.level * 16 }}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link href={`/reader?id=${book.id}&c=${i}&o=0`} className="min-w-0 flex-1 basis-[200px] font-semibold no-underline hover:underline" style={{ color: r.percent > 0 ? 'var(--text)' : 'var(--muted)' }}>
                  <span className="mono mr-3">{String(i + 1).padStart(2, '0')}</span>{r.chapter.title}
                </Link>
                <span className="mono w-12 text-right">{Math.round(r.percent * 100)}%</span>
                <span className="mono w-28">{p ? relativeDay(p.lastReadAt) : 'не начата'}</span>
                <span className="mono w-24">{n ? `${n} ${plural(n, ['заметка', 'заметки', 'заметок'])}` : '—'}</span>
                {book.kind === 'text' && r.percent >= 1 && !text && (
                  <button type="button" className="pill pill-sm" disabled={busy !== null} onClick={() => void recap(r.chapter)}>
                    {busy === r.chapter.id ? 'Пересказываю…' : 'ИИ-пересказ главы'}
                  </button>
                )}
              </div>
              {text && <p className="mt-2 max-w-[760px] text-[14px] text-text-2"><span className="mono mr-2"><span className="dot">●</span> Пересказ</span>{text}</p>}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[13px] text-muted">Пересказ доступен только для прочитанных глав — без спойлеров к тому, что впереди.</p>
    </section>
  );
}

function BookView({ id }: { id: string }) {
  const router = useRouter();
  const book = useBook(id);
  const shelves = useShelves() ?? [];
  const chapters = useLiveQuery(() => db.chapters.where('bookId').equals(id).sortBy('order'), [id]);
  const progress = useLiveQuery(() => db.chapterProgress.where('bookId').equals(id).toArray(), [id]) ?? [];
  const counts = useLiveQuery(async () => {
    const notes = (await db.notes.where('bookId').equals(id).toArray()).filter((n) => !n.deleted);
    return { notes: notes.filter((n) => n.kind !== 'quote').length, quotes: notes.filter((n) => n.kind === 'quote').length };
  }, [id]);
  const { answer, ask } = useAsk();
  const [q, setQ] = useState('');
  const rows = useMemo(() => chapterRows(chapters ?? [], progress, -1, 0), [chapters, progress]);

  if (book === undefined || chapters === undefined) return <p className="mono p-8">Открываю…</p>;
  if (!book || book.deleted) return <div className="page pt-16"><p className="text-text-2">Такой книги нет. <Link href="/" className="underline">На полку</Link></p></div>;

  const submit = (question: string): void => {
    setQ(question);
    void retrieve(question, { bookId: book.id, limit: 6 }).then((sources) => ask(question, sources, { mode: question.startsWith('Поспорь') ? 'debate' : 'book' }));
  };
  const status = book.status === 'finished' ? 'Прочитано' : book.status === 'reading' ? `Читаю · ${Math.round(book.progress * 100)}%` : 'Не начата';

  return (
    <div className="page grid gap-10 pt-8 lg:grid-cols-[300px_1fr]">
      <aside>
        <div className="relative" style={{ aspectRatio: '2 / 3', maxWidth: 300, background: book.color, color: inkOn(book.color) }}>
          {book.cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={book.cover} alt={`Обложка: ${book.title}`} className="h-full w-full object-cover" />
            : (
              <div className="flex h-full flex-col justify-between p-5">
                <span className="font-mono text-[11px] font-semibold tracking-[0.1em]">{book.format.toUpperCase()} · {formatSize(book.size)}</span>
                <span>
                  <span className="display block text-[30px]" style={{ overflowWrap: 'anywhere', hyphens: 'auto' }}>{book.title}</span>
                  <span className="mt-2 block">{book.author}</span>
                </span>
              </div>
            )}
        </div>
        <div className="mt-4 grid gap-2" style={{ maxWidth: 300 }}>
          <Link href={`/reader?id=${book.id}`} className="pill pill-accent">{book.progress > 0 && book.progress < 0.995 ? 'Читать дальше' : 'Читать'}</Link>
          <label className="mono mt-2" htmlFor="shelf">На другую полку</label>
          <select id="shelf" className="field" value={book.shelfId ?? ''} onChange={(e) => void moveBook(book.id, e.target.value || null)}>
            <option value="">Без полки</option>
            {shelves.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="button" className="pill" onClick={() => void db.files.get(book.id).then((f) => f && download(f.name, f.blob, f.type))}>Скачать файл</button>
          <button type="button" className="pill" style={{ color: 'var(--danger)' }} onClick={() => {
            if (window.confirm(`Удалить «${book.title}» с этого устройства? Заметки и цитаты останутся в «Полях».`)) {
              void deleteBook(book.id).then(() => router.push('/'));
            }
          }}>Удалить книгу</button>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4" style={{ maxWidth: 300 }}>
          <div><dt className="mono">Полка</dt><dd>{shelves.find((s) => s.id === book.shelfId)?.name ?? 'Без полки'}</dd></div>
          <div><dt className="mono">Статус</dt><dd>{status}</dd></div>
          <div><dt className="mono">Заметок</dt><dd>{counts ? `${counts.notes} и ${counts.quotes} ${plural(counts.quotes, ['цитата', 'цитаты', 'цитат'])}` : '…'}</dd></div>
          <div><dt className="mono">Добавлена</dt><dd>{book.addedFrom}</dd></div>
          <div><dt className="mono">Объём</dt><dd>{book.pages} стр.</dd></div>
          <div><dt className="mono">Файл</dt><dd>{book.format.toUpperCase()} · {formatSize(book.size)}</dd></div>
        </dl>
      </aside>

      <div className="min-w-0">
        <h1 className="font-display text-[clamp(20px,2.4vw,28px)] font-semibold">{book.title}<span className="font-sans text-[16px] font-normal text-muted"> · {book.author || 'автор не указан'}</span></h1>
        <p className="mono mt-6"><span className="dot">●</span> ИИ-толкование</p>
        <Insight book={book} chapters={chapters} />

        {book.kind === 'text' && (
          <section aria-labelledby="askbook-h" className="mt-12">
            <h2 id="askbook-h" className="mono">Спросить об этой книге</h2>
            <form className="mt-2 flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (q.trim()) submit(q.trim()); }}>
              <label htmlFor="askbook" className="sr-only">Вопрос об этой книге</label>
              <input id="askbook" className="field-underline text-[20px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Что хотел сказать автор, когда…" autoComplete="off" />
              <button type="submit" className="pill pill-accent">Спросить</button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {['Объясни проще', 'Сравни с другими книгами на моей полке', 'Поспорь с моими заметками'].map((s) => (
                <button key={s} type="button" className="pill pill-sm" onClick={() => submit(s === 'Объясни проще' ? 'Объясни главную мысль этой книги проще' : s)}>{s}</button>
              ))}
            </div>
            {answer && <AnswerBlock answer={answer} />}
          </section>
        )}

        {chapters.length > 0 ? <ChapterMap book={book} chapters={chapters} rows={rows} /> : (
          <p className="mt-10 text-text-2">Файла книги на этом устройстве нет — карта глав появится, когда закинешь его в «Облаке».</p>
        )}
      </div>
    </div>
  );
}

function Entry() {
  const params = useSearchParams();
  const books = useBooks();
  const id = params.get('id') ?? lastBook(books)?.id ?? null;
  if (!id) {
    if (books === undefined) return <p className="mono p-8">Открываю…</p>;
    return (
      <div className="page pt-16">
        <h1 className="display" style={{ fontSize: 'var(--fs-h1)' }}>Толковать пока нечего<span className="dot">.</span></h1>
        <p className="mt-4 text-[17px] text-text-2">На полке пока пусто — закинь первую книгу, и здесь появится её страница.</p>
        <Link href="/cloud" className="pill pill-accent mt-6">Закинуть книгу</Link>
      </div>
    );
  }
  return <BookView key={id} id={id} />;
}

export default function BookPage() {
  return <Suspense fallback={<p className="mono p-8">Открываю…</p>}><Entry /></Suspense>;
}
