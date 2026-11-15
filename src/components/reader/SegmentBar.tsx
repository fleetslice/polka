'use client';
import type { ChapterRow } from './model';

/** Сегментированная полоса глав: ширина сегмента пропорциональна длине главы. */
export function SegmentBar({ rows, onGo, label }: { rows: ChapterRow[]; onGo: (index: number) => void; label?: string }) {
  const total = rows.reduce((s, r) => s + r.chapter.lengthChars, 0) || 1;
  return (
    <div className="flex items-center gap-4">
      <ol className="flex min-w-0 flex-1 gap-[2px]" aria-label="Главы книги">
        {rows.map((r, i) => {
          const pct = Math.round(r.percent * 100);
          return (
            <li key={r.chapter.id} style={{ flex: `${Math.max(r.chapter.lengthChars / total, 0.004)} 1 0`, minWidth: 3 }} className="seg relative">
              <button
                type="button"
                onClick={() => onGo(i)}
                aria-label={`${r.chapter.title}: ${pct}%`}
                aria-current={r.status === 'current' ? 'step' : undefined}
                className="block w-full"
                style={{ height: 44, padding: '19px 0' }}
              >
                <span className="relative block h-[6px]" style={{ background: 'var(--line-2)' }}>
                  <i className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: r.status === 'current' ? 'var(--accent)' : 'var(--text-2)' }} />
                </span>
              </button>
              <span role="tooltip" className="seg-tip mono">{r.chapter.title} · {pct}%</span>
            </li>
          );
        })}
      </ol>
      {label && <span className="mono flex-none">{label}</span>}
      <style>{`
        .seg-tip { position: absolute; bottom: 38px; left: 50%; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 6px 10px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; pointer-events: none; opacity: 0; z-index: 5; }
        .seg:hover .seg-tip, .seg:focus-within .seg-tip { opacity: 1; }
        .seg:first-child .seg-tip { left: 0; transform: none; }
        .seg:last-child .seg-tip { left: auto; right: 0; transform: none; }
      `}</style>
    </div>
  );
}
