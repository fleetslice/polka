'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from './db';
import type { Book, Shelf } from './types';

const alive = <T extends { deleted?: 0 | 1 }>(list: T[]): T[] => list.filter((x) => !x.deleted);

/** undefined — данные ещё читаются из IndexedDB. */
export const useBooks = (): Book[] | undefined => useLiveQuery(async () => alive(await db.books.toArray()), []);
export const useShelves = (): Shelf[] | undefined =>
  useLiveQuery(async () => alive(await db.shelves.orderBy('order').toArray()), []);
export const useBook = (id: string | null): Book | null | undefined =>
  useLiveQuery(async () => (id ? ((await db.books.get(id)) ?? null) : null), [id]);
export const useDevices = () => useLiveQuery(async () => alive(await db.devices.toArray()).sort((a, b) => b.lastSeen - a.lastSeen), []);

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = (): void => setMatch(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return match;
}

/** Последняя открытая книга — для пунктов меню «Читаю» и «ИИ-толкователь». */
export const lastBook = (books: Book[] | undefined): Book | undefined =>
  books?.filter((b) => b.lastReadAt).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0] ?? books?.[0];
