import { prisma } from "../db/client";

/** Після стількох повних тижнів поспіль радимо розвантажувальний. */
export const DELOAD_AFTER_WEEKS = 7;
const DAY_MS = 86400000;

export interface DeloadStatus {
  /** Повних тренувальних тижнів поспіль від останнього легкого / пропущеного. */
  weeksInARow: number;
  due: boolean;
  advice: string | null;
}

function weekStart(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
}

/**
 * Тиждень вважається легким (розвантаження, хвороба, відпустка), якщо робочих підходів
 * у ньому менше половини від типового (медіана за 12 тижнів). Рахуємо повні тижні
 * поспіль після останнього легкого; поточний незавершений тиждень не рахується.
 */
export function countWeeksInARow(setsPerWeek: number[]): number {
  if (setsPerWeek.length === 0) return 0;
  const sorted = [...setsPerWeek].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let streak = 0;
  for (let i = setsPerWeek.length - 1; i >= 0; i--) {
    if (setsPerWeek[i] < median * 0.5) break;
    streak++;
  }
  return streak;
}

export async function getDeloadStatus(userId: string): Promise<DeloadStatus> {
  const thisWeek = weekStart(new Date());
  const from = thisWeek - 12 * 7 * DAY_MS;

  const sessions = await prisma.workoutSession.findMany({
    where: { userId, completedAt: { gte: new Date(from), lt: new Date(thisWeek) } },
    include: { _count: { select: { sets: { where: { weight: { gt: 0 }, reps: { gt: 0 } } } } } },
  });

  const weeks = Array.from({ length: 12 }, () => 0);
  for (const s of sessions) {
    const index = Math.floor((weekStart(s.completedAt!) - from) / (7 * DAY_MS));
    if (index >= 0 && index < 12) weeks[index] += s._count.sets;
  }

  const weeksInARow = countWeeksInARow(weeks);
  const due = weeksInARow >= DELOAD_AFTER_WEEKS;
  return {
    weeksInARow,
    due,
    advice: due
      ? `${weeksInARow} тижнів поспіль без розвантаження. Цей тиждень зроби легким: ваги −10–15%, ` +
        "на 1 підхід менше у кожній вправі, без відмови. Суглоби й нервова система відновляться, а сила потім піде вгору."
      : null,
  };
}
