'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useBooks } from '@/lib/hooks';
import { retrieve, sourceHref, type Source } from '@/lib/rag';
import { snippet } from '@/lib/search';

/** Глобальный поиск: названия, авторы и полный текст книг и заметок. */
export function CommandK() {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const books = useBooks();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Source[]>([]);

  useEffect(() => {
    const open = (): void => {
      if (!dialog.current?.open) dialog.current?.showModal();
    };
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('polka:search', open);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('polka:search', open);
    };
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let stale = false;
    const t = window.setTimeout(() => {
      void retrieve(q, { limit: 8 }).then((r) => {
        if (!stale) setHits(r);
      });
    }, 180);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [q]);

  const needle = q.trim().toLowerCase();
  const titled = needle.length < 2 ? [] : (books ?? []).filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(needle)).slice(0, 5);
  const go = (href: string): void => {
    dialog.current?.close();
    setQ('');
    router.push(href);
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Поиск по библиотеке"
      className="m-0 w-full max-w-[720px] border border-line-2 bg-bg-2 p-0 text-text backdrop:bg-black/70"
      style={{ top: '10vh', left: '50%', transform: 'translateX(-50%)', maxHeight: '76vh' }}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="flex flex-col" style={{ maxHeight: '76vh' }}>
        <div className="flex items-center gap-3 border-b border-line px-5">
          <label htmlFor="cmdk" className="mono">Поиск</label>
          <input
            id="cmdk"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Название, автор или фраза из книги"
            className="min-h-[56px] flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted"
            autoComplete="off"
          />
          <button type="button" className="tablink" onClick={() => dialog.current?.close()}>Esc</button>
        </div>
        <div className="overflow-y-auto" aria-live="polite">
          {titled.length > 0 && (
            <ul>
              {titled.map((b) => (
                <li key={b.id} className="border-b border-line">
                  <button type="button" className="flex min-h-[52px] w-full items-center gap-3 px-5 text-left hover:bg-surface" onClick={() => go(`/reader?id=${b.id}`)}>
                    <span className="mono" style={{ color: 'var(--accent)' }}>{b.format}</span>
                    <span className="font-semibold">{b.title}</span>
                    <span className="text-muted">{b.author}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hits.length > 0 && (
            <ul>
              {hits.map((h) => (
                <li key={`${h.kind}-${h.n}`} className="border-b border-line">
                  <button type="button" className="block w-full px-5 py-3 text-left hover:bg-surface" onClick={() => go(sourceHref(h, q))}>
                    <span className="mono block">
                      {h.kind === 'note' ? 'заметка · ' : ''}{h.bookTitle}{h.chapterTitle ? ` · ${h.chapterTitle}` : ''}{h.page ? ` · стр. ${h.page}` : ''}
                    </span>
                    <span className="mt-1 block text-text-2">{snippet(h.text, q)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {needle.length >= 2 && titled.length === 0 && hits.length === 0 && (
            <p className="px-5 py-6 text-muted">Ничего не нашлось. Попробуй другое слово — поиск идёт по тексту книг и заметок.</p>
          )}
          {needle.length < 2 && <p className="px-5 py-6 text-muted">Ищет по названиям, авторам и полному тексту всех книг и заметок.</p>}
        </div>
      </div>
    </dialog>
  );
}
