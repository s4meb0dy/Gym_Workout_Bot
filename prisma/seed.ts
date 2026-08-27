import { prisma } from "../src/db/client";
import { migrateProgramToV8 } from "./migrate-program-v8";
import { classifyMuscleGroup, PROGRAM_VERSION, workoutProgram } from "./workout-program";

async function clearProgramData() {
  await prisma.set.deleteMany();
  await prisma.workoutSession.deleteMany();
  await prisma.exercise.deleteMany();
  await prisma.workoutDay.deleteMany();
  console.log("Cleared existing workout program and session history.");
}

async function seedProgram() {
  for (const day of workoutProgram) {
    await prisma.workoutDay.create({
      data: {
        dayNumber: day.dayNumber,
        weekday: day.weekday,
        name: day.name,
        exercises: {
          create: day.exercises.map((exercise, index) => ({
            name: exercise.name,
            block: exercise.block,
            orderIndex: index + 1,
            targetSets: exercise.targetSets,
            targetRepsMin: exercise.targetRepsMin,
            targetRepsMax: exercise.targetRepsMax,
            bodyPart: exercise.bodyPart,
            muscleGroup: classifyMuscleGroup(exercise.name, exercise.exerciseType),
            exerciseType: exercise.exerciseType ?? "reps",
            progressionMode: exercise.progressionMode ?? "weight",
            progressionStep: exercise.progressionStep ?? 2,
            restTimeInSeconds: exercise.restTimeInSeconds,
            baselineWeightMin: exercise.baselineWeightMin ?? null,
            baselineWeightMax: exercise.baselineWeightMax ?? null,
            baselineNote: exercise.baselineNote ?? null,
            technique: exercise.technique ?? null,
          })),
        },
      },
    });
  }
}

async function isProgramUpToDate(): Promise<boolean> {
  const firstDay = await prisma.workoutDay.findFirst({
    where: { dayNumber: 1 },
    include: { exercises: { orderBy: { orderIndex: "asc" } } },
  });

  if (!firstDay || firstDay.exercises.length === 0) {
    return false;
  }

  // targetSets = 0 — архівні вправи (вилучені з програми, але з історією підходів).
  const active = firstDay.exercises.filter((e) => e.targetSets > 0);
  const isUpperLowerSplit = firstDay.name.includes("Верх");
  const hasMuscleGroups = active.some((e) => e.muscleGroup && e.muscleGroup !== "Інше");
  // З v8 прес більше не стоїть першим — перший рух дня має бути робочим.
  const coreMovedToEnd = active[0]?.exerciseType !== "warmup";

  return (
    isUpperLowerSplit &&
    hasMuscleGroups &&
    coreMovedToEnd &&
    active.length === workoutProgram[0].exercises.length
  );
}

async function main() {
  const forceReseed = process.env.RESEED === "1" || process.argv.includes("--force");

  if (forceReseed) {
    await clearProgramData();
    await seedProgram();
    console.log(`Workout program v${PROGRAM_VERSION} re-seeded successfully (4 days).`);
    return;
  }

  const dayCount = await prisma.workoutDay.count();
  if (dayCount === 0) {
    await seedProgram();
    console.log(`Workout program v${PROGRAM_VERSION} seeded successfully (4 days).`);
    return;
  }

  // Повний перезасів стер би історію підходів, тому стару програму оновлюємо
  // неруйнівною міграцією: вправи переставляються, вилучені глушаться нулем
  // підходів, таблиця Set не змінюється.
  if (await isProgramUpToDate()) {
    console.log(`Workout program present (v${PROGRAM_VERSION}). Skipping seed.`);
    return;
  }

  console.log(`Older program detected — migrating to v${PROGRAM_VERSION} (set history preserved)...`);
  await migrateProgramToV8();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
