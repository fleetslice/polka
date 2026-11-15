import { describe, expect, it } from 'vitest';
import { bookProgress, formatDuration, minutesLeft, plural, readingSpeed, readingStreak, DEFAULT_SPEED } from '@/lib/progress';
import { sm2, SM2_INITIAL } from '@/lib/sm2';
import type { Chapter } from '@/lib/types';

const ch = (id: string, lengthChars: number): Chapter =>
  ({ id, bookId: 'b', parentId: null, order: 0, level: 0, title: id, start: 0, lengthChars, startPage: 1, endPage: 1 });
const DAY = 86_400_000;

describe('прогресс книги', () => {
  it('взвешивает главы по длине в символах', () => {
    const chapters = [ch('a', 1000), ch('b', 3000)];
    expect(bookProgress(chapters, [{ chapterId: 'a', percent: 1 }])).toBeCloseTo(0.25);
    expect(bookProgress(chapters, [{ chapterId: 'a', percent: 1 }, { chapterId: 'b', percent: 0.5 }])).toBeCloseTo(0.625);
  });
  it('пустая книга и мусорные значения не ломают расчёт', () => {
    expect(bookProgress([], [])).toBe(0);
    expect(bookProgress([ch('a', 100)], [{ chapterId: 'a', percent: 7 }])).toBe(1);
    expect(bookProgress([ch('a', 100)], [{ chapterId: 'a', percent: NaN }])).toBe(0);
  });
});

describe('скорость чтения', () => {
  const now = Date.UTC(2026, 5, 15, 12);
  const s = (daysAgo: number, minutes: number, chars: number) =>
    ({ startedAt: now - daysAgo * DAY - minutes * 60_000, endedAt: now - daysAgo * DAY, charsRead: chars });
  it('медиана за 14 дней', () => {
    expect(readingSpeed([s(1, 10, 10_000), s(2, 10, 20_000), s(3, 10, 12_000)], now)).toBe(1200);
  });
  it('старые и слишком короткие сессии не считаются', () => {
    expect(readingSpeed([s(20, 10, 30_000), { startedAt: now - 5000, endedAt: now, charsRead: 900 }], now)).toBe(DEFAULT_SPEED);
  });
  it('время до конца', () => {
    expect(minutesLeft(456_000, 1200)).toBe(380);
    expect(formatDuration(380)).toBe('~6 ч 20 мин');
    expect(formatDuration(12)).toBe('~12 мин');
    expect(formatDuration(119)).toBe('~2 ч');
  });
});

describe('серия дней', () => {
  const now = new Date(2026, 5, 15, 21).getTime();
  it('считает дни подряд, включая вчера, если сегодня ещё не читали', () => {
    expect(readingStreak([{ endedAt: now - DAY }, { endedAt: now - 2 * DAY }, { endedAt: now - 4 * DAY }], now)).toBe(2);
    expect(readingStreak([{ endedAt: now }, { endedAt: now - DAY }], now)).toBe(2);
    expect(readingStreak([{ endedAt: now - 3 * DAY }], now)).toBe(0);
  });
});

describe('склонение', () => {
  it('книга / книги / книг', () => {
    const f: [string, string, string] = ['книга', 'книги', 'книг'];
    expect([1, 2, 5, 11, 21, 112].map((n) => plural(n, f))).toEqual(['книга', 'книги', 'книг', 'книг', 'книга', 'книг']);
  });
});

describe('SM-2', () => {
  const now = 0;
  it('интервалы 1 → 6 → ×ease', () => {
    const a = sm2(SM2_INITIAL, 4, now);
    expect(a.interval).toBe(1);
    const b = sm2(a, 4, now);
    expect(b.interval).toBe(6);
    const c = sm2(b, 4, now);
    expect(c.interval).toBe(15);
    expect(c.dueAt).toBe(15 * DAY);
  });
  it('«Ещё раз» сбрасывает серию и снижает ease не ниже 1.3', () => {
    let st = sm2(sm2(SM2_INITIAL, 5, now), 5, now);
    for (let i = 0; i < 12; i += 1) st = sm2(st, 1, now);
    expect(st.reps).toBe(0);
    expect(st.interval).toBe(1);
    expect(st.ease).toBe(1.3);
  });
});
