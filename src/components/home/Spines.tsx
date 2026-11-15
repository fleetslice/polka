'use client';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import type { Book } from '@/lib/types';

/** Тёмный или светлый текст на корешке — по яркости цвета обложки. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#EDE8DF';
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.55 ? '#121211' : '#EDE8DF';
}

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** Ширина корешка зависит от числа страниц, высота слегка разная — как на настоящей полке. */
export const spineSize = (b: Book): { w: number; h: number } => ({
  w: Math.round(Math.min(92, Math.max(40, 34 + b.pages / 9))),
  h: 210 + (hash(b.id) % 6) * 14,
});

export function Spines({ books, onAdd }: { books: Book[]; onAdd: () => void }) {
  return (
    <div className="overflow-x-auto" style={{ borderBottom: '10px solid var(--shelf)' }}>
      <ul className="flex items-end gap-[6px] px-4 pt-8" style={{ minHeight: 320, background: 'linear-gradient(var(--bg-2), var(--bg-2))' }}>
        {books.map((b) => {
          const { w, h } = spineSize(b);
          const ink = inkOn(b.color);
          return (
            <li key={b.id} className="flex-none">
              <Link
                href={`/reader?id=${b.id}`}
                className="spine relative flex flex-col items-center no-underline"
                style={{ width: w, height: h, background: b.color, color: ink }}
                aria-label={`${b.title}${b.author ? `, ${b.author}` : ''}. ${b.format.toUpperCase()}, прочитано ${Math.round(b.progress * 100)}%`}
              >
                <span aria-hidden className="mt-3 font-mono text-[9px] font-semibold tracking-[0.1em]">{b.format.toUpperCase()}</span>
                <span aria-hidden className="spine-title my-2 flex-1 overflow-hidden font-display font-semibold" style={{ fontSize: w < 48 ? 12 : 14 }}>
                  {b.title}
                </span>
                <span aria-hidden className="spine-title mb-3 max-h-[84px] overflow-hidden text-[10px] opacity-80">{b.author.split(' ').pop()}</span>
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-[4px]" style={{ background: 'rgba(0,0,0,.28)' }}>
                  <i className="block h-full" style={{ width: `${Math.round(b.progress * 100)}%`, background: 'var(--accent)' }} />
                </span>
              </Link>
            </li>
          );
        })}
        <li className="flex-none">
          <button
            type="button"
            onClick={onAdd}
            aria-label="Закинуть книгу на полку"
            className="spine flex items-center justify-center text-muted hover:text-text"
            style={{ width: 56, height: 210, border: '1px dashed var(--line-3)', background: 'transparent' }}
          >
            <Plus size={20} strokeWidth={2} aria-hidden />
          </button>
        </li>
      </ul>
      <style>{`
        .spine { transition: transform var(--t-med) var(--ease); }
        .spine:hover, .spine:focus-visible { transform: translateY(-18px); }
        .spine-title { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; text-overflow: ellipsis; line-height: 1.1; }
      `}</style>
    </div>
  );
}

export function Covers({ books }: { books: Book[] }) {
  return (
    <ul className="grid gap-x-5 gap-y-8" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
      {books.map((b) => (
        <li key={b.id}>
          <Link href={`/reader?id=${b.id}`} className="group block no-underline" aria-label={`Читать: ${b.title}`}>
            <span className="relative block overflow-hidden" style={{ aspectRatio: '2 / 3', background: b.color, color: inkOn(b.color) }}>
              {b.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full flex-col justify-between p-4">
                  <span className="font-mono text-[10px] font-semibold tracking-[0.1em]">{b.format.toUpperCase()}</span>
                  <span className="font-display text-[17px] font-semibold leading-[1.05]" style={{ overflowWrap: 'anywhere' }}>{b.title}</span>
                  <span className="text-[12px] opacity-80">{b.author}</span>
                </span>
              )}
            </span>
            <span className="bar mt-2 block" aria-hidden><i style={{ width: `${Math.round(b.progress * 100)}%` }} /></span>
            <span className="mt-2 block font-semibold leading-tight group-hover:underline">{b.title}</span>
            <span className="block text-[13px] text-muted">{b.author || 'Автор не указан'} · {Math.round(b.progress * 100)}%</span>
          </Link>
          <Link href={`/book?id=${b.id}`} className="mono mt-1 inline-flex min-h-[44px] items-center underline underline-offset-4">О книге</Link>
        </li>
      ))}
    </ul>
  );
}
