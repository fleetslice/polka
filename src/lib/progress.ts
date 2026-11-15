import type { Chapter, ChapterProgress, ReadingSession } from './types';

/** Условная страница перетекаемого текста. */
export const CHARS_PER_PAGE = 1800;
/** Скорость по умолчанию (символов в минуту), пока нет своей статистики. */
export const DEFAULT_SPEED = 1200;
const DAY = 86_400_000;

export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export const pagesFromChars = (chars: number): number => Math.max(1, Math.ceil(chars / CHARS_PER_PAGE));
export const pageOfChar = (offset: number): number => Math.floor(Math.max(0, offset) / CHARS_PER_PAGE) + 1;

/** Прогресс книги = сумма прочитанных символов глав / длина книги. Учитываются только главы-листья. */
export function bookProgress(chapters: Chapter[], progress: Pick<ChapterProgress, 'chapterId' | 'percent'>[]): number {
  const total = chapters.reduce((s, c) => s + c.lengthChars, 0);
  if (total <= 0) return 0;
  const byId = new Map(progress.map((p) => [p.chapterId, clamp01(p.percent)]));
  const read = chapters.reduce((s, c) => s + c.lengthChars * (byId.get(c.id) ?? 0), 0);
  return clamp01(read / total);
}

export const charsRead = (chapters: Chapter[], progress: Pick<ChapterProgress, 'chapterId' | 'percent'>[]): number =>
  Math.round(bookProgress(chapters, progress) * chapters.reduce((s, c) => s + c.lengthChars, 0));

/** Личная скорость чтения: медиана символов в минуту по сессиям за последние 14 дней. */
export function readingSpeed(sessions: Pick<ReadingSession, 'startedAt' | 'endedAt' | 'charsRead'>[], now = Date.now()): number {
  const speeds = sessions
    .filter((s) => s.endedAt >= now - 14 * DAY && s.endedAt - s.startedAt >= 60_000 && s.charsRead > 0)
    .map((s) => s.charsRead / ((s.endedAt - s.startedAt) / 60_000))
    // отсекаем перемотку и «забытую вкладку»
    .filter((v) => v >= 150 && v <= 6000)
    .sort((a, b) => a - b);
  if (speeds.length === 0) return DEFAULT_SPEED;
  const mid = Math.floor(speeds.length / 2);
  const median = speeds.length % 2 ? speeds[mid]! : (speeds[mid - 1]! + speeds[mid]!) / 2;
  return Math.round(median);
}

export const minutesLeft = (chars: number, speed: number): number =>
  chars <= 0 ? 0 : Math.max(1, Math.round(chars / Math.max(1, speed)));

/** «~6 ч 20 мин», «~12 мин». */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0 мин';
  if (minutes < 60) return `~${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = Math.round((minutes % 60) / 5) * 5;
  if (m === 60) return `~${h + 1} ч`;
  return m ? `~${h} ч ${m} мин` : `~${h} ч`;
}

const dayKey = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Серия дней чтения подряд: считается, если читали сегодня или вчера. */
export function readingStreak(sessions: Pick<ReadingSession, 'endedAt'>[], now = Date.now()): number {
  const days = new Set(sessions.map((s) => dayKey(s.endedAt)));
  let cursor = dayKey(now);
  if (!days.has(cursor)) cursor = dayKey(cursor - 1);
  let n = 0;
  while (days.has(cursor)) {
    n += 1;
    cursor = dayKey(cursor - 1);
  }
  return n;
}

export function todayStats(
  sessions: Pick<ReadingSession, 'startedAt' | 'endedAt' | 'charsRead' | 'pagesRead'>[],
  now = Date.now(),
): { pages: number; minutes: number } {
  const today = dayKey(now);
  const list = sessions.filter((s) => dayKey(s.endedAt) === today);
  return {
    pages: list.reduce((s, x) => s + x.pagesRead, 0),
    minutes: Math.round(list.reduce((s, x) => s + (x.endedAt - x.startedAt), 0) / 60_000),
  };
}

/** Русское склонение: plural(3, ['книга','книги','книг']). */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function relativeDay(t: number | undefined, now = Date.now()): string {
  if (!t) return 'ещё не открывали';
  const diff = now - t;
  if (diff < 60_000) return 'сейчас';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  const days = Math.round((dayKey(now) - dayKey(t)) / DAY);
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`;
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}
