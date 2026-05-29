import { Exercise, WorkoutDay, WorkoutSession } from "@prisma/client";
import { prisma } from "../db/client";
import { classifyMuscleGroup } from "./muscle";
import {
  calculateProgression,
  calculateTonnage,
  formatExerciseTarget,
  formatRestDuration,
  formatWeight,
  isWarmupExercise,
  ProgressionResult,
  SetResult,
} from "./progression";

export { formatWarmupPrompt, isWarmupExercise } from "./progression";

export type ExerciseWithDay = Exercise & { workoutDay: WorkoutDay };

export interface WorkoutSummary {
  totalSets: number;
  tonnage: number;
  records: Array<{ exerciseName: string; weight: number; reps: number }>;
}

export async function findOrCreateUser(telegramId: number, username?: string, firstName?: string) {
  return prisma.user.upsert({
    where: { telegramId: BigInt(telegramId) },
    update: { username, firstName },
    create: { telegramId: BigInt(telegramId), username, firstName },
  });
}

export async function getWorkoutDays() {
  return prisma.workoutDay.findMany({
    orderBy: { dayNumber: "asc" },
    include: {
      exercises: { orderBy: { orderIndex: "asc" } },
    },
  });
}

export async function getWorkoutDayByNumber(dayNumber: number) {
  return prisma.workoutDay.findUnique({
    where: { dayNumber },
    include: {
      exercises: { orderBy: { orderIndex: "asc" } },
    },
  });
}

export async function getWorkoutDayById(id: number) {
  return prisma.workoutDay.findUnique({
    where: { id },
    include: { exercises: { orderBy: { orderIndex: "asc" } } },
  });
}

export async function getExerciseById(exerciseId: number) {
  return prisma.exercise.findUnique({ where: { id: exerciseId } });
}

export async function updateExerciseTargets(
  exerciseId: number,
  data: Partial<{ targetSets: number; targetRepsMin: number; targetRepsMax: number }>,
) {
  return prisma.exercise.update({ where: { id: exerciseId }, data });
}

export async function renameExercise(exerciseId: number, name: string) {
  return prisma.exercise.update({
    where: { id: exerciseId },
    data: { name, muscleGroup: classifyMuscleGroup(name) },
  });
}

export async function exerciseHasHistory(exerciseId: number): Promise<boolean> {
  const count = await prisma.set.count({
    where: { exerciseId, weight: { gt: 0 } },
  });
  return count > 0;
}

export async function deleteExercise(exerciseId: number) {
  await prisma.set.deleteMany({ where: { exerciseId } });
  return prisma.exercise.delete({ where: { id: exerciseId } });
}

export async function addExerciseToDay(workoutDayId: number, name: string) {
  const last = await prisma.exercise.findFirst({
    where: { workoutDayId },
    orderBy: { orderIndex: "desc" },
  });
  const orderIndex = (last?.orderIndex ?? 0) + 1;

  return prisma.exercise.create({
    data: {
      workoutDayId,
      name,
      block: "Додано",
      orderIndex,
      targetSets: 3,
      targetRepsMin: 10,
      targetRepsMax: 12,
      bodyPart: "upper",
      muscleGroup: classifyMuscleGroup(name),
      exerciseType: "reps",
      progressionMode: "weight",
      progressionStep: 2,
      restTimeInSeconds: 90,
    },
  });
}

export async function getActiveSession(userId: string) {
  return prisma.workoutSession.findFirst({
    where: { userId, completedAt: null },
    include: {
      workoutDay: {
        include: { exercises: { orderBy: { orderIndex: "asc" } } },
      },
      sets: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { startedAt: "desc" },
  });
}

export async function startWorkoutSession(userId: string, workoutDayId: number) {
  const existing = await getActiveSession(userId);
  if (existing) {
    throw new Error("ACTIVE_SESSION_EXISTS");
  }

  return prisma.workoutSession.create({
    data: { userId, workoutDayId },
    include: {
      workoutDay: {
        include: { exercises: { orderBy: { orderIndex: "asc" } } },
      },
      sets: true,
    },
  });
}

export async function cancelActiveSession(userId: string) {
  const active = await getActiveSession(userId);
  if (!active) {
    return null;
  }

  await prisma.workoutSession.delete({ where: { id: active.id } });
  return active;
}

export async function getLastCompletedSession(userId: string, workoutDayId: number) {
  return prisma.workoutSession.findFirst({
    where: {
      userId,
      workoutDayId,
      completedAt: { not: null },
    },
    orderBy: { completedAt: "desc" },
    include: { sets: true },
  });
}

export async function getExerciseHistorySets(
  userId: string,
  workoutDayId: number,
  exerciseId: number,
): Promise<SetResult[]> {
  const lastSession = await getLastCompletedSession(userId, workoutDayId);
  if (!lastSession) {
    return [];
  }

  return lastSession.sets
    .filter((set) => set.exerciseId === exerciseId && set.weight > 0 && set.reps > 0)
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((set) => ({ weight: set.weight, reps: set.reps }));
}

export async function getProgressionForExercise(
  userId: string,
  exercise: Exercise,
  workoutDayId: number,
): Promise<ProgressionResult> {
  if (isWarmupExercise(exercise)) {
    return {
      lastWeight: 0,
      lastReps: 0,
      suggestedWeight: 0,
      shouldIncreaseWeight: false,
      message: "",
    };
  }

  const lastSets = await getExerciseHistorySets(userId, workoutDayId, exercise.id);
  return calculateProgression(
    lastSets,
    exercise.targetSets,
    exercise.targetRepsMin,
    exercise.targetRepsMax,
    exercise.bodyPart as "upper" | "lower",
    {
      baselineWeightMin: exercise.baselineWeightMin,
      baselineWeightMax: exercise.baselineWeightMax,
      baselineNote: exercise.baselineNote,
      progressionMode: exercise.progressionMode as "weight" | "assist",
      progressionStep: exercise.progressionStep,
      exerciseType: exercise.exerciseType as "reps" | "time",
    },
  );
}

export interface ExerciseState {
  exercise: Exercise;
  setNumber: number;
  exerciseIndex: number;
  totalExercises: number;
}

export function getCurrentExerciseState(
  session: WorkoutSession & {
    workoutDay: { exercises: Exercise[] };
    sets: Array<{ exerciseId: number }>;
  },
): ExerciseState | null {
  const exercises = session.workoutDay.exercises;
  for (let i = 0; i < exercises.length; i++) {
    const exercise = exercises[i];
    const loggedSets = session.sets.filter((set) => set.exerciseId === exercise.id);
    if (loggedSets.length < exercise.targetSets) {
      return {
        exercise,
        setNumber: loggedSets.length + 1,
        exerciseIndex: i + 1,
        totalExercises: exercises.length,
      };
    }
  }
  return null;
}

export function isWorkoutComplete(
  session: WorkoutSession & {
    workoutDay: { exercises: Exercise[] };
    sets: Array<{ exerciseId: number }>;
  },
): boolean {
  return getCurrentExerciseState(session) === null;
}

export async function logSet(
  sessionId: string,
  exerciseId: number,
  setNumber: number,
  weight: number,
  reps: number,
  rpe?: number | null,
  note?: string | null,
) {
  return prisma.set.create({
    data: {
      workoutSessionId: sessionId,
      exerciseId,
      setNumber,
      weight,
      reps,
      rpe: rpe ?? null,
      note: note ?? null,
    },
  });
}

export async function getSessionSets(sessionId: string) {
  return prisma.set.findMany({
    where: { workoutSessionId: sessionId },
    orderBy: { createdAt: "asc" },
    include: { exercise: true },
  });
}

export async function getSetById(setId: string) {
  return prisma.set.findUnique({
    where: { id: setId },
    include: { exercise: true },
  });
}

export async function updateSet(
  setId: string,
  weight: number,
  reps: number,
  rpe?: number | null,
  note?: string | null,
) {
  return prisma.set.update({
    where: { id: setId },
    data: { weight, reps, rpe: rpe ?? null, note: note ?? null },
    include: { exercise: true },
  });
}

export async function reloadSession(sessionId: string) {
  return prisma.workoutSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      workoutDay: {
        include: { exercises: { orderBy: { orderIndex: "asc" } } },
      },
      sets: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function deleteLastSet(sessionId: string) {
  const last = await prisma.set.findFirst({
    where: { workoutSessionId: sessionId },
    orderBy: { createdAt: "desc" },
    include: { exercise: true },
  });

  if (!last) {
    return null;
  }

  await prisma.set.delete({ where: { id: last.id } });
  return last;
}

export async function completeWorkoutSession(sessionId: string): Promise<WorkoutSummary> {
  const session = await prisma.workoutSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      sets: {
        include: { exercise: true },
        orderBy: [{ exerciseId: "asc" }, { setNumber: "asc" }],
      },
    },
  });

  await prisma.workoutSession.update({
    where: { id: sessionId },
    data: { completedAt: new Date() },
  });

  const validSets = session.sets.filter((s) => s.weight > 0 && s.reps > 0);
  const totalSets = validSets.length;
  const tonnage = calculateTonnage(validSets.map((s) => ({ weight: s.weight, reps: s.reps })));

  const records: WorkoutSummary["records"] = [];
  const byExercise = new Map<number, typeof session.sets>();

  for (const set of validSets) {
    const list = byExercise.get(set.exerciseId) ?? [];
    list.push(set);
    byExercise.set(set.exerciseId, list);
  }

  for (const [, sets] of byExercise) {
    const best = sets.reduce((max, set) => (set.weight > max.weight ? set : max), sets[0]);
    const previousBest = await prisma.set.findFirst({
      where: {
        exerciseId: best.exerciseId,
        workoutSession: {
          userId: session.userId,
          completedAt: { not: null },
          id: { not: sessionId },
        },
      },
      orderBy: { weight: "desc" },
    });

    if (!previousBest || best.weight > previousBest.weight) {
      records.push({
        exerciseName: best.exercise.name,
        weight: best.weight,
        reps: best.reps,
      });
    }
  }

  return { totalSets, tonnage, records };
}

export async function getUserStats(userId: string) {
  const completedSessions = await prisma.workoutSession.findMany({
    where: { userId, completedAt: { not: null } },
    include: {
      workoutDay: true,
      sets: true,
    },
    orderBy: { completedAt: "desc" },
  });

  const totalWorkouts = completedSessions.length;
  const totalSets = completedSessions.reduce(
    (sum, session) => sum + session.sets.filter((s) => s.weight > 0 && s.reps > 0).length,
    0,
  );
  const totalTonnage = completedSessions.reduce(
    (sum, session) =>
      sum + calculateTonnage(session.sets.map((s) => ({ weight: s.weight, reps: s.reps }))),
    0,
  );

  const personalRecords = await prisma.set.findMany({
    where: {
      workoutSession: { userId, completedAt: { not: null } },
      weight: { gt: 0 },
      reps: { gt: 0 },
    },
    include: { exercise: true },
    orderBy: { weight: "desc" },
  });

  const bestByExercise = new Map<number, (typeof personalRecords)[0]>();
  for (const record of personalRecords) {
    const existing = bestByExercise.get(record.exerciseId);
    if (!existing || record.weight > existing.weight) {
      bestByExercise.set(record.exerciseId, record);
    }
  }

  const records = Array.from(bestByExercise.values())
    .sort((a, b) => b.weight - a.weight)
    .map((record) => ({
      exerciseName: record.exercise.name,
      weight: record.weight,
      reps: record.reps,
    }));

  const recentSessions = completedSessions.slice(0, 5).map((session) => {
    const workingSets = session.sets.filter((s) => s.weight > 0 && s.reps > 0);
    return {
      dayName: session.workoutDay.name,
      date: session.completedAt!,
      sets: workingSets.length,
      tonnage: calculateTonnage(workingSets.map((s) => ({ weight: s.weight, reps: s.reps }))),
    };
  });

  return { totalWorkouts, totalSets, totalTonnage, records, recentSessions };
}

export function formatExercisePrompt(
  exercise: Exercise,
  setNumber: number,
  progression: ProgressionResult,
  exerciseIndex?: number,
  totalExercises?: number,
): string {
  const exerciseType = exercise.exerciseType as "reps" | "time";
  const repTarget = formatExerciseTarget(
    exercise.targetRepsMin,
    exercise.targetRepsMax,
    exerciseType,
  );

  const progressLine =
    exerciseIndex && totalExercises ? `📍 Вправа ${exerciseIndex}/${totalExercises}\n` : "";
  const header = `${progressLine}🏋️ <b>${exercise.name}</b>\n📦 ${exercise.block}\n`;
  const targets =
    `Підхід ${setNumber}/${exercise.targetSets} • Ціль: ${repTarget}\n` +
    `⏱️ Відпочинок між підходами: ${formatRestDuration(exercise.restTimeInSeconds)}\n`;

  let technique = "";
  if (exercise.technique) {
    technique = `\n💡 ${exercise.technique}\n`;
  }

  const hint =
    exerciseType === "time"
      ? `\n\nВведи результат: <code>вага x секунди</code>\nНаприклад: <code>20x45</code>`
      : `\n\nВведи результат: <code>вага x повторення</code>\nНаприклад: <code>14x10</code>`;

  return header + targets + technique + "\n" + progression.message + hint;
}

export function formatWorkoutSummary(summary: WorkoutSummary): string {
  let text =
    `✅ <b>Тренування завершено!</b>\n\n` +
    `📊 Підходів: ${summary.totalSets}\n` +
    `⚖️ Загальний тоннаж: ${formatWeight(summary.tonnage)} кг\n`;

  if (summary.records.length > 0) {
    text += `\n🏆 <b>Нові рекорди:</b>\n`;
    for (const record of summary.records) {
      text += `• ${record.exerciseName}: ${formatWeight(record.weight)} кг × ${record.reps}\n`;
    }
  } else {
    text += `\nСьогодні нових рекордів немає — але тренування зараховано! 💪`;
  }

  return text;
}
