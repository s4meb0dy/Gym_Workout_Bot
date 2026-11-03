import { prisma } from "../src/db/client";
import { classifyMuscleGroup, workoutProgram } from "./workout-program";

/**
 * v12 → v13 без втрати історії:
 * - гоблет (стеля — найважча гантель 30 кг) → присідання в сміті;
 * - румунська тяга з гантелями (2×28 кг упирались у хват) → зі штангою.
 *   Старі вправи архівуються (targetSets = 0) разом з історією, нові стають на їхнє місце;
 * - махи в сторони: 12–20 повторень і крок 1 кг (прогресія спершу повторами);
 * - підказки про суперсети на ізоляції Верху B.
 *
 *   npx tsx prisma/migrate-program-v13.ts --dry
 */
const DRY = process.argv.includes("--dry");

function seedExercise(dayNumber: number, name: string) {
  const exercise = workoutProgram.find((d) => d.dayNumber === dayNumber)?.exercises.find((e) => e.name === name);
  if (!exercise) throw new Error(`Exercise not in seed: ${name}`);
  return exercise;
}

function log(message: string) {
  console.log(`${DRY ? "[dry] " : ""}${message}`);
}

/** Стара вправа → архів, нова (з сіду) — на її місце в порядку дня. */
async function replaceExercise(dayNumber: number, oldName: string, newName: string) {
  const day = await prisma.workoutDay.findUniqueOrThrow({ where: { dayNumber }, include: { exercises: true } });
  if (day.exercises.some((e) => e.name === newName && e.targetSets > 0)) {
    log(`Day ${dayNumber}: "${newName}" already in place`);
    return;
  }
  const old = day.exercises.find((e) => e.name === oldName && e.targetSets > 0);
  if (!old) throw new Error(`Day ${dayNumber}: "${oldName}" not found`);

  const seed = seedExercise(dayNumber, newName);
  log(`Day ${dayNumber}: "${oldName}" → archive, "${newName}" ${seed.targetSets}×${seed.targetRepsMin}–${seed.targetRepsMax} at #${old.orderIndex}`);
  if (DRY) return;

  const maxOrder = Math.max(...day.exercises.map((e) => e.orderIndex));
  await prisma.$transaction([
    prisma.exercise.update({ where: { id: old.id }, data: { targetSets: 0, orderIndex: maxOrder + 1 } }),
    prisma.exercise.create({
      data: {
        workoutDayId: day.id,
        name: seed.name,
        block: seed.block,
        orderIndex: old.orderIndex,
        targetSets: seed.targetSets,
        targetRepsMin: seed.targetRepsMin,
        targetRepsMax: seed.targetRepsMax,
        bodyPart: seed.bodyPart,
        muscleGroup: classifyMuscleGroup(seed.name, seed.exerciseType),
        exerciseType: seed.exerciseType ?? "reps",
        progressionMode: seed.progressionMode ?? "weight",
        progressionStep: seed.progressionStep ?? 2,
        restTimeInSeconds: seed.restTimeInSeconds,
        baselineWeightMin: seed.baselineWeightMin ?? null,
        baselineWeightMax: seed.baselineWeightMax ?? null,
        baselineNote: seed.baselineNote ?? null,
        technique: seed.technique ?? null,
      },
    }),
  ]);
}

/** Підтягує діапазон повторів, крок і техніку з сіду для наявної вправи. */
async function syncExercise(dayNumber: number, name: string) {
  const seed = seedExercise(dayNumber, name);
  const day = await prisma.workoutDay.findUniqueOrThrow({ where: { dayNumber }, include: { exercises: true } });
  const existing = day.exercises.find((e) => e.name === name && e.targetSets > 0);
  if (!existing) throw new Error(`Day ${dayNumber}: "${name}" not found`);

  const data = {
    targetRepsMin: seed.targetRepsMin,
    targetRepsMax: seed.targetRepsMax,
    progressionStep: seed.progressionStep ?? 2,
    technique: seed.technique ?? null,
  };
  const changed = (Object.keys(data) as Array<keyof typeof data>).filter((k) => existing[k] !== data[k]);
  if (changed.length === 0) return;
  log(`Day ${dayNumber}: "${name}" update ${changed.join(", ")}`);
  if (!DRY) await prisma.exercise.update({ where: { id: existing.id }, data });
}

async function main() {
  await replaceExercise(2, "Goblet Squats (присідання з гантеллю перед грудьми)", "Присідання в сміті");
  await replaceExercise(4, "Румунська тяга з гантелями", "Румунська тяга зі штангою");
  await syncExercise(1, "Махи гантелей в сторони (Lateral Raises)");
  await syncExercise(3, "Махи гантелей у нахилі (задня дельта)");
  await syncExercise(3, "Махи в сторони на блоці (кросовер)");
  await syncExercise(3, "Молоткові підйоми (Hammer Curls)");
  await syncExercise(3, "Розгинання з-за голови на блоці (трицепс)");
  log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
