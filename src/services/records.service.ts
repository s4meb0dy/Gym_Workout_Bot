import { prisma } from "../db/client";
import { estimateOneRepMax } from "./chart.service";
import { formatWeight } from "./progression";

export type RecordKind = "weight" | "e1rm" | "reps";

export interface SetRecord {
  kind: RecordKind;
  text: string;
}

interface PastSet {
  weight: number;
  reps: number;
}

/**
 * Чи є підхід рекордом відносно всієї історії вправи. Пріоритет: більша вага →
 * більший оціночний 1ПМ → більше повторів на тій самій (або більшій) вазі.
 * Перший у житті підхід рекордом не вважається — порівнювати нема з чим.
 */
export function classifyRecord(set: PastSet, history: PastSet[]): SetRecord | null {
  const past = history.filter((s) => s.weight > 0 && s.reps > 0);
  if (past.length === 0 || set.weight <= 0 || set.reps <= 0) return null;

  const maxWeight = Math.max(...past.map((s) => s.weight));
  if (set.weight > maxWeight + 0.01) {
    return { kind: "weight", text: `Рекорд ваги: ${formatWeight(set.weight)} кг (було ${formatWeight(maxWeight)})` };
  }

  const e1rm = estimateOneRepMax(set.weight, set.reps);
  const maxE1rm = Math.max(...past.map((s) => estimateOneRepMax(s.weight, s.reps)));
  if (e1rm > maxE1rm + 0.05) {
    return {
      kind: "e1rm",
      text: `Рекорд 1ПМ: ${formatWeight(Math.round(e1rm * 10) / 10)} кг (було ${formatWeight(Math.round(maxE1rm * 10) / 10)})`,
    };
  }

  const atLeastAsHeavy = past.filter((s) => s.weight >= set.weight - 0.01);
  const maxReps = atLeastAsHeavy.length ? Math.max(...atLeastAsHeavy.map((s) => s.reps)) : 0;
  if (atLeastAsHeavy.length > 0 && set.reps > maxReps) {
    return { kind: "reps", text: `Рекорд повторів на ${formatWeight(set.weight)} кг: ${set.reps} (було ${maxReps})` };
  }

  return null;
}

/** Рекорд для щойно записаного підходу — порівнюємо з усіма іншими підходами цієї вправи. */
export async function detectSetRecord(userId: string, setId: string): Promise<SetRecord | null> {
  const set = await prisma.set.findFirst({ where: { id: setId, workoutSession: { userId } } });
  if (!set) return null;

  const history = await prisma.set.findMany({
    where: {
      exerciseId: set.exerciseId,
      id: { not: set.id },
      weight: { gt: 0 },
      reps: { gt: 0 },
      workoutSession: { userId },
    },
    select: { weight: true, reps: true },
  });
  return classifyRecord(set, history);
}
