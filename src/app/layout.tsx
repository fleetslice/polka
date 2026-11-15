import type { Metadata, Viewport } from 'next';
// Шрифты лежат в проекте (@fontsource): сборке не нужен доступ к Google Fonts.
import '@fontsource/unbounded/600.css';
import '@fontsource/unbounded/800.css';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/literata/400.css';
import '@fontsource/literata/600.css';
import '@fontsource/literata/400-italic.css';
import './globals.css';
import { Chrome } from '@/components/Chrome';
import { BASE } from '@/lib/base';


export const metadata: Metadata = {
  title: { default: 'ПОЛКА. — личная библиотека', template: '%s — ПОЛКА.' },
  description: 'Личная библиотека электронных книг: любые форматы, свои полки, прогресс по главам, заметки и ИИ-толкователь.',
  manifest: `${BASE}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: 'ПОЛКА.', statusBarStyle: 'black-translucent' },
  icons: { icon: `${BASE}/icon.svg`, apple: `${BASE}/icon-192.png` },
};

export const viewport: Viewport = { themeColor: '#121211', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
