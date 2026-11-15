'use client';
import { Cloud, Library, NotebookPen, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNav } from './Header';

const ICONS = { '01': Library, '03': NotebookPen, '04': Sparkles, '05': Cloud } as const;

/** Нижний таб-бар на телефоне: Полка / Заметки / ИИ / Облако. */
export function TabBar() {
  const pathname = usePathname();
  const nav = useNav().filter((i) => i.n in ICONS);
  return (
    <nav
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-bg md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {nav.map((item) => {
        const Icon = ICONS[item.n as keyof typeof ICONS];
        const active = item.match(pathname);
        return (
          <Link
            key={item.n}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className="flex min-h-[56px] flex-col items-center justify-center gap-1 text-[12px] no-underline"
            style={{ color: active ? 'var(--text)' : 'var(--muted)', boxShadow: active ? 'inset 0 2px 0 var(--accent)' : undefined }}
          >
            <Icon size={20} strokeWidth={2} aria-hidden />
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}
