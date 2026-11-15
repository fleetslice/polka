'use client';
import { ArrowRight } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AnswerText, SourceList } from '@/components/Ask';
import { addNote, deleteNote } from '@/lib/actions';
import { AiUnavailable, askStream } from '@/lib/ai';
import { retrieve, type Source } from '@/lib/rag';
import { useSettings } from '@/lib/settings';
import type { Book, Chapter, Locator, Note } from '@/lib/types';

interface Turn { q: string; a: string; sources: Source[]; selection?: string; state: 'loading' | 'done' | 'no-ai' | 'error'; saved?: boolean }
export interface SidePanelHandle { ask: (question: string, selection?: string) => void; focusNote: (highlightId?: string) => void }

interface Props {
  book: Book;
  chapter: Chapter | undefined;
  locator: Locator;
  page: number;
  notes: Note[];
  onJump: (l: Locator) => void;
}

export const SidePanel = forwardRef<SidePanelHandle, Props>(function SidePanel({ book, chapter, locator, page, notes, onJump }, ref) {
  const [tab, setTab] = useState<'ai' | 'notes'>('ai');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState('');
  const [draftHl, setDraftHl] = useState<string | undefined>();
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const { noSpoilers, set } = useSettings();
  const latest = useRef({ locator, noSpoilers, turns });
  latest.current = { locator, noSpoilers, turns };

  const ask = async (question: string, selection?: string): Promise<void> => {
    setTab('ai');
    const { locator: loc, noSpoilers: ns } = latest.current;
    const idx = latest.current.turns.length;
    const sources = await retrieve(`${question} ${selection ?? ''}`, {
      bookId: book.id, limit: 5, upTo: ns ? { chapter: loc.chapter, offset: loc.offset + 4000 } : undefined,
    });
    const history = latest.current.turns.filter((t) => t.state === 'done').slice(-3)
      .flatMap((t) => [{ role: 'user' as const, content: t.q }, { role: 'assistant' as const, content: t.a }]);
    setTurns((t) => [...t, { q: question, a: '', sources, selection, state: 'loading' }]);
    const patch = (p: Partial<Turn>): void => setTurns((t) => t.map((x, i) => (i === idx ? { ...x, ...p } : x)));
    let text = '';
    try {
      await askStream({
        question, selection, mode: selection ? 'passage' : 'book', noSpoilers: ns, history,
        sources: sources.map(({ n, kind, bookTitle, chapterTitle, page: p, text: t }) => ({ n, kind, bookTitle, chapterTitle, page: p, text: t })),
      }, (chunk) => {
        text += chunk;
        patch({ a: text });
      });
      patch({ state: 'done' });
    } catch (e) {
      patch(e instanceof AiUnavailable
        ? { state: 'no-ai', a: 'ИИ не подключён: на сервере нет ключа. Ниже — близкие места из этой книги.' }
        : { state: 'error', a: e instanceof Error ? e.message : 'ИИ не ответил.' });
    }
  };

  useImperativeHandle(ref, () => ({
    ask: (question, selection) => void ask(question, selection),
    focusNote: (highlightId) => {
      setTab('notes');
      setDraftHl(highlightId);
      window.setTimeout(() => noteInput.current?.focus(), 50);
    },
  }));

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [turns]);

  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Панель книги" className="flex gap-2 p-4">
        <button type="button" role="tab" id="tab-ai" aria-controls="panel-ai" aria-selected={tab === 'ai'} className="pill flex-1" onClick={() => setTab('ai')}>ИИ-толкователь</button>
        <button type="button" role="tab" id="tab-notes" aria-controls="panel-notes" aria-selected={tab === 'notes'} className="pill flex-1" onClick={() => setTab('notes')}>
          Заметки · {notes.length}
        </button>
      </div>

      {tab === 'ai' ? (
        <div role="tabpanel" id="panel-ai" aria-labelledby="tab-ai" className="flex min-h-0 flex-1 flex-col">
          <div ref={feed} className="flex-1 overflow-y-auto px-4" aria-live="polite">
            {turns.length === 0 && (
              <p className="text-[14px] text-text-2">
                Выдели место в тексте и нажми «Спросить ИИ» — или задай вопрос о книге ниже. Ответ опирается на текст книги и твои заметки.
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className="mb-6">
                <p className="ml-6 rounded-[14px] bg-surface px-4 py-3 text-[14px]">{t.q}</p>
                {t.selection && <p className="ml-6 mt-1 line-clamp-2 text-[12px] italic text-muted">«{t.selection}»</p>}
                <p className="mono mt-4"><span className="dot">●</span> Ответ</p>
                <div className="mt-2 text-[14px]">
                  {t.state === 'loading' && !t.a ? <p className="text-muted">Читаю книгу…</p> : <AnswerText text={t.a} sources={t.sources} />}
                </div>
                {(t.state === 'no-ai' || t.state === 'done') && t.sources.length > 0 && <SourceList sources={t.sources} query={t.q} />}
                {t.state === 'done' && (
                  <button
                    type="button"
                    className="pill pill-sm mt-3"
                    disabled={t.saved}
                    onClick={() => {
                      void addNote({ kind: 'ai', bodyMd: `**${t.q}**\n\n${t.a}`, bookId: book.id, chapter, locator });
                      setTurns((all) => all.map((x, j) => (j === i ? { ...x, saved: true } : x)));
                    }}
                  >
                    {t.saved ? 'Сохранено в заметки' : 'Сохранить в заметки'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-line p-4">
            <button type="button" className="pill pill-sm mb-3" aria-pressed={noSpoilers} onClick={() => set('noSpoilers', !noSpoilers)}
              title="ИИ не использует текст дальше места, где ты остановился">
              Без спойлеров
            </button>
            <form className="flex gap-2" onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) {
                void ask(q.trim());
                setQ('');
              }
            }}>
              <label htmlFor="panel-ask" className="sr-only">Вопрос об этой книге</label>
              <input id="panel-ask" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Спроси о книге…" autoComplete="off" />
              <button type="submit" className="icon-btn icon-btn-accent" aria-label="Спросить"><ArrowRight size={18} aria-hidden /></button>
            </form>
          </div>
        </div>
      ) : (
        <div role="tabpanel" id="panel-notes" aria-labelledby="tab-notes" className="flex min-h-0 flex-1 flex-col">
          <ul className="flex-1 overflow-y-auto px-4">
            {notes.length === 0 && <li className="text-[14px] text-text-2">К этой книге пока нет заметок. Выдели фразу и нажми «Цитата» или запиши мысль ниже.</li>}
            {notes.map((n) => (
              <li key={n.id} className="border-b border-line py-3">
                <button type="button" className="block w-full text-left" onClick={() => n.locator && onJump(n.locator)}>
                  <span className="mono">{n.kind === 'quote' ? 'Цитата' : n.kind === 'ai' ? 'Ответ ИИ' : 'Моя мысль'}{n.page ? ` · стр. ${n.page}` : ''}</span>
                  <span className={`mt-1 line-clamp-5 block whitespace-pre-wrap text-[14px] ${n.kind === 'quote' ? 'font-book italic' : ''}`}>{n.bodyMd}</span>
                </button>
                <button type="button" className="mono mt-1 min-h-[44px] underline underline-offset-4" onClick={() => window.confirm('Удалить заметку?') && void deleteNote(n.id)}>Удалить</button>
              </li>
            ))}
          </ul>
          <form className="border-t border-line p-4" onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            void addNote({ kind: 'thought', bodyMd: draft, bookId: book.id, chapter, locator, highlightId: draftHl });
            setDraft('');
            setDraftHl(undefined);
          }}>
            <label htmlFor="new-note" className="mono">Новая заметка к стр. {page}</label>
            <textarea id="new-note" ref={noteInput} className="field mt-2" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder="Мысль, вопрос, #тег" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit(); e.stopPropagation(); }} />
            <button type="submit" className="pill pill-accent mt-2" disabled={!draft.trim()}>Сохранить заметку</button>
          </form>
        </div>
      )}
    </div>
  );
});
