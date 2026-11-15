'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const ACCENTS = ['#C8F031', '#FF6A3D', '#8FB8FF', '#F2C14E'] as const;
export type ReaderTheme = 'night' | 'paper' | 'sepia';
export type ShelfView = 'spines' | 'covers';
export type SortKey = 'recent' | 'author' | 'title' | 'progress' | 'added';

interface Settings {
  accent: string;
  shelfView: ShelfView;
  sort: SortKey;
  theme: ReaderTheme;
  fontSize: number;
  lineHeight: number;
  margin: number; // внутренние поля страницы, px
  fontFamily: 'literata' | 'golos' | 'mono';
  columns: 1 | 2;
  flow: 'paged' | 'scroll';
  progressOpen: boolean;
  panelOpen: boolean;
  noSpoilers: boolean;
  set: <K extends keyof Omit<Settings, 'set'>>(key: K, value: Settings[K]) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      accent: ACCENTS[0],
      shelfView: 'spines',
      sort: 'recent',
      theme: 'paper',
      fontSize: 19,
      lineHeight: 1.65,
      margin: 56,
      fontFamily: 'literata',
      columns: 1,
      flow: 'scroll',
      progressOpen: true,
      panelOpen: true,
      noSpoilers: true,
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
    }),
    { name: 'polka.settings' },
  ),
);
