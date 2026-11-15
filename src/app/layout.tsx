import type { Metadata, Viewport } from 'next';
import { Golos_Text, JetBrains_Mono, Literata, Unbounded } from 'next/font/google';
import './globals.css';
import { Chrome } from '@/components/Chrome';

const display = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['600', '800'], variable: '--font-display', display: 'swap' });
const ui = Golos_Text({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'], variable: '--font-ui', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], weight: ['400', '600'], variable: '--font-mono', display: 'swap' });
const book = Literata({ subsets: ['latin', 'cyrillic'], weight: ['400', '600'], style: ['normal', 'italic'], variable: '--font-book', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'ПОЛКА. — личная библиотека', template: '%s — ПОЛКА.' },
  description: 'Личная библиотека электронных книг: любые форматы, свои полки, прогресс по главам, заметки и ИИ-толкователь.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'ПОЛКА.', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
};

export const viewport: Viewport = { themeColor: '#121211', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${display.variable} ${ui.variable} ${mono.variable} ${book.variable}`}>
      <body>
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
