import { prisma } from "../db/client";
import { estimateOneRepMax } from "./chart.service";
import { effectiveLoad, formatLoad, formatWeight } from "./progression";

export type RecordKind = "weight" | "e1rm" | "reps";

export interface SetRecord {
  kind: RecordKind;
  text: string;
}

interface PastSet {
  weight: number;
  reps: number;
}

export interface RecordOptions {
  /** "assist" — Гравітон: менша противага = складніше. */
  progressionMode?: string;
  /** Для противаги навантаження рахується як вага тіла мінус противага. */
  bodyWeightKg?: number;
}

/** Вага тіла за замовчуванням, якщо зважувань ще немає (для порівнянь достатньо). */
const DEFAULT_BODYWEIGHT = 70;

/**
 * Чи є підхід рекордом відносно всієї історії вправи. Пріоритет: більше навантаження
 * (для Гравітона — менша противага) → більший оціночний 1ПМ → більше повторів на тому
 * самому чи більшому навантаженні. Перший у житті підхід рекордом не вважається.
 */
export function classifyRecord(set: PastSet, history: PastSet[], options: RecordOptions = {}): SetRecord | null {
  const mode = options.progressionMode;
  const bodyWeight = options.bodyWeightKg ?? DEFAULT_BODYWEIGHT;
  const load = (s: PastSet) => effectiveLoad(s.weight, mode, bodyWeight);
  const label = (weight: number) => formatLoad(weight, mode);

  const past = history.filter((s) => s.weight > 0 && s.reps > 0);
  if (past.length === 0 || set.weight <= 0 || set.reps <= 0) return null;

  const best = past.reduce((b, s) => (load(s) > load(b) ? s : b), past[0]);
  if (load(set) > load(best) + 0.01) {
    return { kind: "weight", text: `Рекорд: ${label(set.weight)} (було ${label(best.weight)})` };
  }

  const e1rm = estimateOneRepMax(load(set), set.reps);
  const maxE1rm = Math.max(...past.map((s) => estimateOneRepMax(load(s), s.reps)));
  if (e1rm > maxE1rm + 0.05) {
    const suffix = mode === "assist" ? " з вагою тіла" : "";
    return {
      kind: "e1rm",
      text: `Рекорд 1ПМ${suffix}: ${formatWeight(Math.round(e1rm * 10) / 10)} кг (було ${formatWeight(Math.round(maxE1rm * 10) / 10)})`,
    };
  }

  const atLeastAsHard = past.filter((s) => load(s) >= load(set) - 0.01);
  const maxReps = atLeastAsHard.length ? Math.max(...atLeastAsHard.map((s) => s.reps)) : 0;
  if (atLeastAsHard.length > 0 && set.reps > maxReps) {
    return { kind: "reps", text: `Рекорд повторів (${label(set.weight)}): ${set.reps} (було ${maxReps})` };
  }

  return null;
}

/** Остання вага тіла — для ефективного навантаження вправ з противагою. */
export async function latestBodyWeight(userId: string): Promise<number | undefined> {
  const row = await prisma.bodyWeight.findFirst({ where: { userId }, orderBy: { recordedAt: "desc" } });
  return row?.weightKg;
}

/** Рекорд для щойно записаного підходу — порівнюємо з усіма іншими підходами цієї вправи. */
export async function detectSetRecord(userId: string, setId: string): Promise<SetRecord | null> {
  const set = await prisma.set.findFirst({ where: { id: setId, workoutSession: { userId } }, include: { exercise: true } });
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
  return classifyRecord(set, history, {
    progressionMode: set.exercise.progressionMode,
    bodyWeightKg: await latestBodyWeight(userId),
  });
}
