'use client';
import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { plural } from '@/lib/progress';
import type { Book, Highlight, Note } from '@/lib/types';
import { charsLeft, leftLabel, totalProgress, type ChapterRow } from './model';

interface Props {
  book: Book;
  rows: ChapterRow[];
  speed: number;
  highlights: Highlight[];
  notes: Note[];
  today: { pages: number; minutes: number };
  streak: number;
  currentLeft: number; // символов до конца текущей главы
  onGo: (index: number) => void;
}

export function ProgressSidebar({ book, rows, speed, highlights, notes, today, streak, currentLeft, onGo }: Props) {
  const currentRef = useRef<HTMLLIElement>(null);
  const currentId = rows.find((r) => r.status === 'current')?.chapter.id;
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  const progress = totalProgress(rows);
  const leaves = rows.filter((r) => r.chapter.lengthChars > 0);
  const done = leaves.filter((r) => r.percent >= 1).length;
  const page = Math.min(book.pages, Math.max(1, Math.round(progress * book.pages)));
  const timed = book.kind === 'text';
  const unit = book.kind === 'audio' ? 'Сек.' : 'Стр.';

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-5">
        <p className="mono">Прогресс</p>
        <p className="display mt-2 text-[56px]" aria-label={`Прочитано ${Math.round(progress * 100)} процентов книги`}>
          {Math.round(progress * 100)}<span className="dot">%</span>
        </p>
        <div className="bar mt-3" aria-hidden><i style={{ width: `${progress * 100}%` }} /></div>
        <p className="mt-3 text-[14px]">{unit} {page} из {book.pages}</p>
        {timed && <p className="text-[14px] text-text-2">{progress >= 0.995 ? 'Книга дочитана' : `${leftLabel(charsLeft(rows), speed)} до конца`}</p>}
        <p className="mono mt-3">Прочитано {done} из {leaves.length} {plural(leaves.length, ['главы', 'глав', 'глав'])}</p>
      </div>

      <ol className="flex-1 overflow-y-auto py-2" aria-label="Оглавление и прогресс по главам">
        {rows.map((r, i) => {
          const hl = highlights.filter((h) => h.chapterId === r.chapter.id);
          const nn = notes.filter((n) => n.chapterId === r.chapter.id).length;
          const current = r.status === 'current';
          const muted = r.status === 'new';
          return (
            <li key={r.chapter.id} ref={current ? currentRef : undefined}>
              <button
                type="button"
                onClick={() => onGo(i)}
                aria-current={current ? 'step' : undefined}
                className="block w-full py-2 pr-4 text-left hover:bg-surface"
                style={{ paddingLeft: 20 + r.chapter.level * 14, background: current ? 'var(--surface)' : undefined, minHeight: 44 }}
              >
                <span className="flex items-baseline gap-2">
                  <span className="mono w-6 flex-none" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1 text-[14px] leading-snug" style={{ color: muted ? 'var(--muted)' : 'var(--text)', fontWeight: r.chapter.level === 0 || current ? 600 : 400 }}>
                    {r.chapter.title}
                  </span>
                  {r.status === 'done' && <Check size={14} strokeWidth={2} aria-label="прочитана" style={{ color: 'var(--accent)', flex: 'none' }} />}
                  {(hl.length > 0 || nn > 0) && (
                    <span className="flex flex-none items-center gap-[3px]" aria-label={`${hl.length} ${plural(hl.length, ['выделение', 'выделения', 'выделений'])}, ${nn} ${plural(nn, ['заметка', 'заметки', 'заметок'])}`}>
                      {hl.slice(0, 4).map((h) => (
                        <i key={h.id} aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: h.color === 'accent' ? 'var(--accent)' : 'var(--accent-2)' }} />
                      ))}
                      <span className="mono" aria-hidden>{hl.length + nn}</span>
                    </span>
                  )}
                </span>
                <span className="mt-2 block h-[2px]" style={{ marginLeft: 32, background: 'var(--line-2)' }} aria-hidden>
                  <i className="block h-full" style={{ width: `${r.percent * 100}%`, background: current ? 'var(--accent)' : 'var(--text-2)' }} />
                </span>
                {current && timed && (
                  <span className="mono mt-2 block" style={{ marginLeft: 32, color: 'var(--accent)' }}>
                    {currentLeft > 0 ? `осталось ${leftLabel(currentLeft, speed)} в главе` : 'глава дочитана'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-line p-5 text-[14px]">
        <p>Сегодня: {today.pages} стр. · {today.minutes} мин</p>
        <p className="text-text-2">
          {streak > 0 ? `${streak} ${plural(streak, ['день', 'дня', 'дней'])} чтения подряд` : 'Серия начнётся с сегодняшнего чтения'}
        </p>
      </div>
    </div>
  );
}
