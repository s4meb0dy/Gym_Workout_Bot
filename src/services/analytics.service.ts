import { prisma } from "../db/client";
import { estimateOneRepMax } from "./chart.service";

export interface MuscleVolume {
  muscleGroup: string;
  sets: number;
  tonnage: number;
}

/** Робочі підходи по м'язових групах за останні N днів. */
export async function getWeeklyVolume(userId: string, days = 7): Promise<MuscleVolume[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const sets = await prisma.set.findMany({
    where: {
      weight: { gt: 0 },
      reps: { gt: 0 },
      workoutSession: { userId, completedAt: { not: null, gte: since } },
    },
    include: { exercise: true },
  });

  const byGroup = new Map<string, MuscleVolume>();
  for (const set of sets) {
    const group = set.exercise.muscleGroup || "Інше";
    const entry = byGroup.get(group) ?? { muscleGroup: group, sets: 0, tonnage: 0 };
    entry.sets += 1;
    entry.tonnage += set.weight * set.reps;
    byGroup.set(group, entry);
  }

  return Array.from(byGroup.values()).sort((a, b) => b.sets - a.sets);
}

export interface ExerciseOption {
  exerciseId: number;
  name: string;
  sessions: number;
}

/** Вправи, що мають історію з вагою (для вибору графіка прогресу). */
export async function getExercisesWithHistory(userId: string): Promise<ExerciseOption[]> {
  const sets = await prisma.set.findMany({
    where: {
      weight: { gt: 0 },
      reps: { gt: 0 },
      workoutSession: { userId, completedAt: { not: null } },
    },
    include: { exercise: true, workoutSession: true },
  });

  const byExercise = new Map<number, { name: string; sessions: Set<string> }>();
  for (const set of sets) {
    const entry = byExercise.get(set.exerciseId) ?? {
      name: set.exercise.name,
      sessions: new Set<string>(),
    };
    entry.sessions.add(set.workoutSessionId);
    byExercise.set(set.exerciseId, entry);
  }

  return Array.from(byExercise.entries())
    .map(([exerciseId, v]) => ({ exerciseId, name: v.name, sessions: v.sessions.size }))
    .sort((a, b) => b.sessions - a.sessions);
}

export interface OneRmPoint {
  date: Date;
  oneRm: number;
  bestWeight: number;
  bestReps: number;
}

/** Динаміка оцінки 1ПМ по вправі (найкращий підхід кожного тренування). */
export async function getOneRmHistory(userId: string, exerciseId: number): Promise<OneRmPoint[]> {
  const sessions = await prisma.workoutSession.findMany({
    where: {
      userId,
      completedAt: { not: null },
      sets: { some: { exerciseId, weight: { gt: 0 } } },
    },
    orderBy: { completedAt: "asc" },
    include: {
      sets: { where: { exerciseId, weight: { gt: 0 }, reps: { gt: 0 } } },
    },
  });

  const points: OneRmPoint[] = [];
  for (const session of sessions) {
    if (session.sets.length === 0) continue;
    let best = session.sets[0];
    let bestRm = estimateOneRepMax(best.weight, best.reps);
    for (const set of session.sets) {
      const rm = estimateOneRepMax(set.weight, set.reps);
      if (rm > bestRm) {
        best = set;
        bestRm = rm;
      }
    }
    points.push({
      date: session.completedAt!,
      oneRm: Math.round(bestRm * 10) / 10,
      bestWeight: best.weight,
      bestReps: best.reps,
    });
  }

  return points;
}

export interface CompletedSessionSummary {
  id: string;
  date: Date;
  dayName: string;
  sets: number;
  tonnage: number;
}

export async function getCompletedSessions(
  userId: string,
  limit = 10,
): Promise<CompletedSessionSummary[]> {
  const sessions = await prisma.workoutSession.findMany({
    where: { userId, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: limit,
    include: { workoutDay: true, sets: true },
  });

  return sessions.map((s) => {
    const working = s.sets.filter((x) => x.weight > 0 && x.reps > 0);
    return {
      id: s.id,
      date: s.completedAt!,
      dayName: s.workoutDay.name,
      sets: working.length,
      tonnage: working.reduce((acc, x) => acc + x.weight * x.reps, 0),
    };
  });
}

export async function getSessionDetail(sessionId: string) {
  return prisma.workoutSession.findUnique({
    where: { id: sessionId },
    include: {
      workoutDay: true,
      sets: {
        include: { exercise: true },
        orderBy: [{ exerciseId: "asc" }, { setNumber: "asc" }],
      },
    },
  });
}

export interface StallInfo {
  stalled: boolean;
  sessions: number;
  weight: number;
}

/**
 * Застій: робоча вага у вправі не зростала останні N тренувань поспіль.
 */
export async function detectExerciseStall(
  userId: string,
  workoutDayId: number,
  exerciseId: number,
  minSessions = 3,
): Promise<StallInfo> {
  const sessions = await prisma.workoutSession.findMany({
    where: {
      userId,
      workoutDayId,
      completedAt: { not: null },
      sets: { some: { exerciseId, weight: { gt: 0 } } },
    },
    orderBy: { completedAt: "desc" },
    take: minSessions,
    include: { sets: { where: { exerciseId, weight: { gt: 0 }, reps: { gt: 0 } } } },
  });

  if (sessions.length < minSessions) {
    return { stalled: false, sessions: sessions.length, weight: 0 };
  }

  const bestWeights = sessions.map((s) => Math.max(...s.sets.map((x) => x.weight)));
  const allEqual = bestWeights.every((w) => Math.abs(w - bestWeights[0]) < 0.1);

  return { stalled: allEqual, sessions: sessions.length, weight: bestWeights[0] };
}

export interface SessionSetRow {
  date: string;
  dayName: string;
  exerciseName: string;
  setNumber: number;
  weight: number;
  reps: number;
  rpe: number | null;
  note: string | null;
}

/** Уся історія підходів користувача для експорту в CSV. */
export async function getAllSetsForExport(userId: string): Promise<SessionSetRow[]> {
  const sessions = await prisma.workoutSession.findMany({
    where: { userId, completedAt: { not: null } },
    orderBy: { completedAt: "asc" },
    include: {
      workoutDay: true,
      sets: { include: { exercise: true }, orderBy: [{ exerciseId: "asc" }, { setNumber: "asc" }] },
    },
  });

  const rows: SessionSetRow[] = [];
  for (const session of sessions) {
    const date = session.completedAt!.toISOString();
    for (const set of session.sets) {
      rows.push({
        date,
        dayName: session.workoutDay.name,
        exerciseName: set.exercise.name,
        setNumber: set.setNumber,
        weight: set.weight,
        reps: set.reps,
        rpe: set.rpe,
        note: set.note,
      });
    }
  }
  return rows;
}
