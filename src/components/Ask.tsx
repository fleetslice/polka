'use client';
import Link from 'next/link';
import { Fragment, useRef, useState } from 'react';
import { AiUnavailable, askStream, type AskPayload } from '@/lib/ai';
import { sourceHref, type Source } from '@/lib/rag';
import { snippet } from '@/lib/search';

export interface Answer { question: string; text: string; sources: Source[]; state: 'loading' | 'done' | 'no-ai' | 'error' | 'empty'; error?: string }

/** Общая логика вопроса к ИИ: найти источники → потоковый ответ. Без ключа ИИ показывает найденные места. */
export function useAsk() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const abort = useRef<AbortController | null>(null);

  const ask = async (question: string, sources: Source[], extra: Partial<AskPayload> = {}): Promise<string> => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    if (!sources.length && !extra.selection) {
      setAnswer({ question, text: '', sources, state: 'empty' });
      return '';
    }
    setAnswer({ question, text: '', sources, state: 'loading' });
    let text = '';
    try {
      await askStream(
        { question, mode: 'library', ...extra, sources: sources.map(({ n, kind, bookTitle, chapterTitle, page, text: t }) => ({ n, kind, bookTitle, chapterTitle, page, text: t })) },
        (chunk) => {
          text += chunk;
          setAnswer({ question, text, sources, state: 'loading' });
        },
        ctrl.signal,
      );
      setAnswer({ question, text, sources, state: 'done' });
    } catch (e) {
      if (ctrl.signal.aborted) return text;
      if (e instanceof AiUnavailable) setAnswer({ question, text: '', sources, state: 'no-ai' });
      else setAnswer({ question, text, sources, state: 'error', error: e instanceof Error ? e.message : 'Ошибка' });
    }
    return text;
  };
  return { answer, ask, reset: () => setAnswer(null) };
}

/** Текст ответа со ссылками [n] на источники: клик открывает это место в книге. */
export function AnswerText({ text, sources }: { text: string; sources: Source[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        const src = m ? sources.find((s) => s.n === Number(m[1])) : undefined;
        if (!src) return <Fragment key={i}>{part}</Fragment>;
        return (
          <Link key={i} href={sourceHref(src)} className="mx-[2px] font-mono text-[12px] underline underline-offset-2" style={{ color: 'var(--accent)' }}
            aria-label={`Источник ${src.n}: ${src.bookTitle}${src.page ? `, страница ${src.page}` : ''}`}>
            [{src.n}]
          </Link>
        );
      })}
    </p>
  );
}

export function SourceList({ sources, query }: { sources: Source[]; query: string }) {
  if (!sources.length) return null;
  return (
    <ol className="mt-4 border-t border-line">
      {sources.map((s) => (
        <li key={s.n} className="border-b border-line">
          <Link href={sourceHref(s, query)} className="flex gap-3 py-3 no-underline hover:bg-bg-2">
            <span className="mono" style={{ color: 'var(--accent)', minWidth: 28 }}>[{s.n}]</span>
            <span>
              <span className="mono block">
                {s.kind === 'note' ? 'заметка · ' : ''}{s.bookTitle}{s.chapterTitle ? ` · ${s.chapterTitle}` : ''}{s.page ? ` · стр. ${s.page}` : ''}
              </span>
              <span className="mt-1 block text-[14px] text-text-2">{snippet(s.text, query, 110)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function AnswerBlock({ answer }: { answer: Answer }) {
  return (
    <div aria-live="polite" className="mt-5">
      {answer.state === 'empty' && <p className="text-text-2">В твоих книгах и заметках об этом ничего не нашлось. Переформулируй вопрос или закинь книгу по теме.</p>}
      {answer.state === 'no-ai' && (
        <p className="text-text-2">ИИ не подключён (на сервере нет ключа), поэтому связного ответа не будет. Вот самые близкие места из твоих книг:</p>
      )}
      {answer.state === 'error' && <p style={{ color: 'var(--danger)' }}>{answer.error}</p>}
      {answer.text && <AnswerText text={answer.text} sources={answer.sources} />}
      {answer.state === 'loading' && !answer.text && <p className="mono">Ищу в твоих книгах…</p>}
      <SourceList sources={answer.sources} query={answer.question} />
    </div>
  );
}
