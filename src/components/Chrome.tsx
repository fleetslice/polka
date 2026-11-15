'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BASE } from '@/lib/base';
import { touchDevice } from '@/lib/device';
import { useSettings } from '@/lib/settings';
import { startSync } from '@/lib/sync';
import { CommandK } from './CommandK';
import { Header } from './Header';
import { TabBar } from './TabBar';

export function Chrome({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000 } } }));
  const pathname = usePathname();
  const accent = useSettings((s) => s.accent);
  const bare = pathname.startsWith('/reader');

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
  }, [accent]);

  useEffect(() => {
    void touchDevice();
    const beat = window.setInterval(() => void touchDevice(), 60_000);
    const stop = startSync();
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker.register(`${BASE}/sw.js`);
    }
    return () => {
      window.clearInterval(beat);
      stop();
    };
  }, []);

  return (
    <QueryClientProvider client={client}>
      <a href="#main" className="skip pill pill-accent">
        К содержимому
      </a>
      {!bare && <Header />}
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
      {!bare && <TabBar />}
      <CommandK />
    </QueryClientProvider>
  );
}
