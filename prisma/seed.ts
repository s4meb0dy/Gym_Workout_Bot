import { prisma } from "../src/db/client";
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

  const firstExercise = firstDay.exercises[0];
  const isUpperLowerSplit = firstDay.name.includes("Верх");
  const hasMuscleGroups = firstDay.exercises.some(
    (e) => e.muscleGroup && e.muscleGroup !== "Інше",
  );

  return (
    firstExercise?.exerciseType === "warmup" &&
    isUpperLowerSplit &&
    hasMuscleGroups &&
    firstDay.exercises.length === workoutProgram[0].exercises.length
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

  // Програму більше НЕ перезаписуємо автоматично: користувач може редагувати її
  // через бота, тому авто-перезапис стер би його зміни. Для примусового
  // оновлення з коду використовуй `npm run db:reseed` (--force).
  const upToDate = await isProgramUpToDate();
  console.log(
    upToDate
      ? `Workout program present (v${PROGRAM_VERSION}). Skipping seed.`
      : "Existing program detected (possibly customized). Skipping auto-update. Use db:reseed to force.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
