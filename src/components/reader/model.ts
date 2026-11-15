import { formatDuration, minutesLeft } from '@/lib/progress';
import type { Chapter, ChapterProgress } from '@/lib/types';

export type ChapterStatus = 'done' | 'current' | 'new' | 'started';
export interface ChapterRow { chapter: Chapter; percent: number; status: ChapterStatus }

/** Сводит главы, сохранённый прогресс и текущую позицию в строки для сайдбара и сегментированной полосы. */
export function chapterRows(chapters: Chapter[], progress: ChapterProgress[], current: number, liveReadTo: number): ChapterRow[] {
  const byId = new Map(progress.map((p) => [p.chapterId, p.percent]));
  return chapters.map((chapter, i) => {
    let percent = byId.get(chapter.id) ?? 0;
    if (i === current && chapter.lengthChars) percent = Math.max(percent, Math.min(1, liveReadTo / chapter.lengthChars));
    if (percent >= 0.985) percent = 1;
    const status: ChapterStatus = i === current ? 'current' : percent >= 1 ? 'done' : percent > 0 ? 'started' : 'new';
    return { chapter, percent, status };
  });
}

export const totalProgress = (rows: ChapterRow[]): number => {
  const total = rows.reduce((s, r) => s + r.chapter.lengthChars, 0);
  return total ? rows.reduce((s, r) => s + r.chapter.lengthChars * r.percent, 0) / total : 0;
};

export const charsLeft = (rows: ChapterRow[]): number =>
  Math.round(rows.reduce((s, r) => s + r.chapter.lengthChars * (1 - r.percent), 0));

export const leftLabel = (chars: number, speed: number): string => formatDuration(minutesLeft(chars, speed));

/** Номер главы для подписи: считаются только главы-листья своего уровня («Глава 3»). */
export const chapterNumber = (chapters: Chapter[], index: number): number =>
  chapters.slice(0, index + 1).filter((c) => c.level === chapters[index]?.level).length;
