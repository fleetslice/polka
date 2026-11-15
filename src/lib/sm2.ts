/** Интервальное повторение SM-2. grade: 0..5 (≥3 — вспомнил). */
export interface Sm2State { ease: number; interval: number; reps: number; dueAt: number }

const DAY = 86_400_000;
export const SM2_INITIAL = { ease: 2.5, interval: 0, reps: 0 };

export function sm2(state: Pick<Sm2State, 'ease' | 'interval' | 'reps'>, grade: number, now = Date.now()): Sm2State {
  const q = Math.min(5, Math.max(0, Math.round(grade)));
  let { ease, interval, reps } = state;
  if (q < 3) {
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return { ease: Math.round(ease * 100) / 100, interval, reps, dueAt: now + interval * DAY };
}

/** Кнопки интерфейса: «Ещё раз» = 1, «Помню» = 4. */
export const GRADE_AGAIN = 1;
export const GRADE_GOOD = 4;
