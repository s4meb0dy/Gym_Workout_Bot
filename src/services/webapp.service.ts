import { Exercise } from "@prisma/client";
import { config } from "../config/env";
import { prisma } from "../db/client";
import { detectExerciseStall } from "./analytics.service";
import { getBaselineWeight, isWarmupExercise } from "./progression";
import {
  getActiveSession,
  getLastCompletedSession,
  getProgressionForExercise,
  getWorkoutDays,
  isArchivedExercise,
} from "./workout.service";

const WEEKDAY_TO_DAY_NUMBER: Record<string, number> = { Mon: 1, Wed: 2, Fri: 3, Sun: 4 };

function todayDayNumber(): number | null {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    weekday: "short",
  }).format(new Date());
  return WEEKDAY_TO_DAY_NUMBER[weekday] ?? null;
}

export async function buildDaysView(userId: string) {
  const days = await getWorkoutDays();
  const today = todayDayNumber();

  return Promise.all(
    days.map(async (day) => {
      const last = await getLastCompletedSession(userId, day.id);
      const active = day.exercises.filter((e) => !isArchivedExercise(e));
      return {
        dayNumber: day.dayNumber,
        weekday: day.weekday,
        name: day.name,
        exerciseCount: active.filter((e) => !isWarmupExercise(e)).length,
        isToday: day.dayNumber === today,
        lastCompletedAt: last?.completedAt ?? null,
      };
    }),
  );
}

async function buildExerciseView(
  userId: string,
  workoutDayId: number,
  exercise: Exercise,
  sets: Array<{ id: string; exerciseId: number; setNumber: number; weight: number; reps: number; extraReps: number }>,
) {
  const todaySets = sets
    .filter((s) => s.exerciseId === exercise.id)
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((s) => ({ id: s.id, setNumber: s.setNumber, weight: s.weight, reps: s.reps, extraReps: s.extraReps }));

  const warmup = isWarmupExercise(exercise);
  const progression = warmup
    ? null
    : await getProgressionForExercise(userId, exercise, workoutDayId);
  const stall = warmup ? null : await detectExerciseStall(userId, workoutDayId, exercise.id);

  const suggestedWeight =
    progression && progression.suggestedWeight > 0
      ? progression.suggestedWeight
      : getBaselineWeight({
          baselineWeightMin: exercise.baselineWeightMin,
          baselineWeightMax: exercise.baselineWeightMax,
        });

  return {
    id: exercise.id,
    name: exercise.name,
    block: exercise.block,
    type: exercise.exerciseType as "reps" | "time" | "warmup",
    progressionMode: exercise.progressionMode as "weight" | "assist",
    progressionStep: exercise.progressionStep || 2,
    targetSets: exercise.targetSets,
    targetRepsMin: exercise.targetRepsMin,
    targetRepsMax: exercise.targetRepsMax,
    restSeconds: exercise.restTimeInSeconds,
    technique: exercise.technique,
    sets: todaySets,
    lastSets: progression?.lastSets ?? [],
    suggestedWeight,
    shouldIncrease: progression?.shouldIncreaseWeight ?? false,
    stalledWeight: stall?.stalled ? stall.weight : null,
  };
}

export async function buildWorkoutView(userId: string) {
  const session = await getActiveSession(userId);
  if (!session) {
    return null;
  }

  const exercises = session.workoutDay.exercises.filter((e) => !isArchivedExercise(e));
  const views = await Promise.all(
    exercises.map((exercise) =>
      buildExerciseView(userId, session.workoutDayId, exercise, session.sets),
    ),
  );

  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    day: {
      dayNumber: session.workoutDay.dayNumber,
      weekday: session.workoutDay.weekday,
      name: session.workoutDay.name,
    },
    exercises: views,
  };
}

export async function buildProgramView(userId: string) {
  const days = await getWorkoutDays();
  return Promise.all(
    days.map(async (day) => ({
      dayNumber: day.dayNumber,
      weekday: day.weekday,
      name: day.name,
      exercises: await Promise.all(
        day.exercises
          .filter((e) => !isArchivedExercise(e))
          .map(async (e) => {
            const warmup = isWarmupExercise(e);
            const progression = warmup ? null : await getProgressionForExercise(userId, e, day.id);
            return {
              id: e.id,
              name: e.name,
              block: e.block,
              type: e.exerciseType as "reps" | "time" | "warmup",
              progressionMode: e.progressionMode as "weight" | "assist",
              progressionStep: e.progressionStep,
              targetSets: e.targetSets,
              targetRepsMin: e.targetRepsMin,
              targetRepsMax: e.targetRepsMax,
              restSeconds: e.restTimeInSeconds,
              technique: e.technique,
              muscleGroup: e.muscleGroup,
              workingWeight: progression && progression.lastWeight > 0 ? progression.lastWeight : null,
              nextWeight: progression && progression.suggestedWeight > 0 ? progression.suggestedWeight : null,
              hasHistory: progression ? progression.lastSets.length > 0 : false,
            };
          }),
      ),
    })),
  );
}

export async function buildHistoryList(userId: string, limit = 40) {
  const sessions = await prisma.workoutSession.findMany({
    where: { userId, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: limit,
    include: { workoutDay: true, sets: { where: { weight: { gt: 0 }, reps: { gt: 0 } } } },
  });

  return sessions.map((s) => ({
    id: s.id,
    completedAt: s.completedAt!,
    dayName: s.workoutDay.name,
    weekday: s.workoutDay.weekday,
    durationMinutes: Math.round((s.completedAt!.getTime() - s.startedAt.getTime()) / 60000),
    sets: s.sets.length,
    tonnage: Math.round(s.sets.reduce((sum, x) => sum + x.weight * x.reps, 0)),
  }));
}

export async function buildHistoryDetail(userId: string, sessionId: string) {
  const session = await prisma.workoutSession.findFirst({
    where: { id: sessionId, userId, completedAt: { not: null } },
    include: {
      workoutDay: true,
      sets: { include: { exercise: true }, orderBy: [{ setNumber: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!session) {
    return null;
  }

  const groups = new Map<
    number,
    { name: string; order: number; mode: string; sets: Array<{ weight: number; reps: number; extraReps: number }> }
  >();
  for (const set of session.sets) {
    if (set.weight <= 0 || set.reps <= 0) continue;
    const group = groups.get(set.exerciseId) ?? {
      name: set.exercise.name,
      order: set.exercise.orderIndex,
      mode: set.exercise.progressionMode,
      sets: [],
    };
    group.sets.push({ weight: set.weight, reps: set.reps, extraReps: set.extraReps });
    groups.set(set.exerciseId, group);
  }

  const exercises = [...groups.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([exerciseId, g]) => ({ exerciseId, name: g.name, progressionMode: g.mode, sets: g.sets }));

  return {
    id: session.id,
    completedAt: session.completedAt!,
    dayName: session.workoutDay.name,
    durationMinutes: Math.round((session.completedAt!.getTime() - session.startedAt.getTime()) / 60000),
    tonnage: Math.round(exercises.reduce((sum, e) => sum + e.sets.reduce((s, x) => s + x.weight * x.reps, 0), 0)),
    exercises,
  };
}

function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

/** Тренування й тоннаж по тижнях (з понеділка) за останні `weeks` тижнів. */
export async function buildWeeklyStats(userId: string, weeks = 8) {
  const firstWeek = weekStart(new Date());
  firstWeek.setUTCDate(firstWeek.getUTCDate() - (weeks - 1) * 7);

  const sessions = await prisma.workoutSession.findMany({
    where: { userId, completedAt: { gte: firstWeek } },
    include: { sets: { where: { weight: { gt: 0 }, reps: { gt: 0 } } } },
  });

  const buckets = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(firstWeek);
    start.setUTCDate(start.getUTCDate() + i * 7);
    return { weekStart: start.toISOString().slice(0, 10), workouts: 0, sets: 0, tonnage: 0 };
  });

  for (const s of sessions) {
    const key = weekStart(s.completedAt!).toISOString().slice(0, 10);
    const bucket = buckets.find((b) => b.weekStart === key);
    if (!bucket) continue;
    bucket.workouts += 1;
    bucket.sets += s.sets.length;
    bucket.tonnage += Math.round(s.sets.reduce((sum, x) => sum + x.weight * x.reps, 0));
  }

  return buckets;
}

/** Підхід, що належить активному тренуванню цього користувача (інакше null). */
export async function findOwnActiveSet(userId: string, setId: string) {
  return prisma.set.findFirst({
    where: { id: setId, workoutSession: { userId, completedAt: null } },
    include: { exercise: true },
  });
}

export async function nextSetNumber(sessionId: string, exerciseId: number): Promise<number> {
  const last = await prisma.set.findFirst({
    where: { workoutSessionId: sessionId, exerciseId },
    orderBy: { setNumber: "desc" },
  });
  return (last?.setNumber ?? 0) + 1;
}
