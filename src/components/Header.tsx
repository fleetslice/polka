'use client';
import { Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef } from 'react';
import { lastBook, useBooks, useDevices, useOnline, useSyncEmail } from '@/lib/hooks';
import { importFiles } from '@/lib/import';
import { plural } from '@/lib/progress';
import { syncConfigured } from '@/lib/sync';

export const ACCEPT = '.epub,.fb2,.zip,.fbz,.pdf,.mobi,.azw,.azw3,.djvu,.djv,.docx,.doc,.odt,.rtf,.txt,.md,.cbz,.cbr,.html,.htm,.mp3,.m4b,.m4a';

export function useNav() {
  const books = useBooks();
  const last = lastBook(books);
  return [
    { n: '01', label: 'Полка', short: 'Полка', href: '/', match: (p: string) => p === '/' },
    { n: '02', label: 'Читаю', short: 'Читаю', href: last ? `/reader?id=${last.id}` : '/reader', match: (p: string) => p.startsWith('/reader') },
    { n: '03', label: 'Заметки', short: 'Заметки', href: '/notes', match: (p: string) => p.startsWith('/notes') },
    { n: '04', label: 'ИИ-толкователь', short: 'ИИ', href: last ? `/book?id=${last.id}` : '/book', match: (p: string) => p.startsWith('/book') },
    { n: '05', label: 'Облако', short: 'Облако', href: '/cloud', match: (p: string) => p.startsWith('/cloud') },
  ];
}

export function SyncStatus() {
  const devices = useDevices();
  const online = useOnline();
  const email = useSyncEmail();
  const n = devices?.length ?? 1;
  const label = !online
    ? 'офлайн · догонит при сети'
    : !syncConfigured()
      ? 'только это устройство'
      : email
        ? `${n} ${plural(n, ['устройство', 'устройства', 'устройств'])} · синхр.`
        : 'войди, чтобы синхронизировать';
  return (
    <Link href="/cloud#devices" className="mono hidden items-center gap-2 no-underline lg:inline-flex" style={{ minHeight: 44 }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: online ? 'var(--accent)' : 'var(--muted)' }} />
      <span>{label}</span>
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const nav = useNav();
  const input = useRef<HTMLInputElement>(null);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg">
      <div className="flex items-center gap-3 px-[var(--gutter)] py-3" style={{ maxWidth: 1640, margin: '0 auto' }}>
        <Link href="/" className="display mr-2 text-[22px] no-underline" aria-label="ПОЛКА. — на главную" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
          ПОЛКА<span className="dot">.</span>
        </Link>
        <nav aria-label="Разделы" className="hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <Link key={item.n} href={item.href} className="pill pill-ghost pill-sm" aria-current={item.match(pathname) ? 'page' : undefined}>
              <span className="num">{item.n}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <SyncStatus />
          <button
            type="button"
            className="icon-btn"
            aria-label="Поиск по библиотеке (Ctrl+K)"
            onClick={() => window.dispatchEvent(new CustomEvent('polka:search'))}
          >
            <Search size={18} strokeWidth={2} aria-hidden />
          </button>
          <button type="button" className="pill pill-accent" onClick={() => input.current?.click()}>
            <Upload size={16} strokeWidth={2} aria-hidden />
            <span className="hidden xs:inline">Закинуть книгу</span>
            <span className="xs:hidden">Закинуть</span>
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (!files.length) return;
              router.push('/cloud#queue');
              void importFiles(files);
            }}
          />
        </div>
      </div>
    </header>
  );
}
