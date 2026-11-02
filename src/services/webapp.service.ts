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
  sets: Array<{ id: string; exerciseId: number; setNumber: number; weight: number; reps: number }>,
) {
  const todaySets = sets
    .filter((s) => s.exerciseId === exercise.id)
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((s) => ({ id: s.id, setNumber: s.setNumber, weight: s.weight, reps: s.reps }));

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
