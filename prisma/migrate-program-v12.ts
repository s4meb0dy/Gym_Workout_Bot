import { prisma } from "../src/db/client";
import { classifyMuscleGroup, workoutProgram } from "./workout-program";

/**
 * v11 → v12 без втрати історії:
 * - з 5 жовтня жим на похилій робиться в сміті (вага на грифі), а не гантелями (вага однієї
 *   гантелі). Підходи до цієї дати переносимо в архівну гантельну вправу, а поточна стає
 *   сміт-жимом — графіки, рекорди й прогресія більше не змішують дві різні вправи;
 * - +3 підходи бічної дельти й +2 трицепса (Верх B), +1 підхід трицепса (Верх A) і біцепса (Верх B).
 *
 *   npx tsx prisma/migrate-program-v12.ts --dry   # лише показати план
 */
const DRY = process.argv.includes("--dry");
const SMITH_SINCE = new Date("2026-10-05T00:00:00Z");
const OLD_INCLINE = "Жим гантелей на похилій лаві (верх грудей)";
const ARCHIVED_INCLINE = "Жим гантелей на похилій лаві (архів, до сміта)";

function seedExercise(dayNumber: number, name: string) {
  const day = workoutProgram.find((d) => d.dayNumber === dayNumber)!;
  const index = day.exercises.findIndex((e) => e.name === name);
  if (index < 0) throw new Error(`Exercise not in seed: ${name}`);
  return day.exercises[index];
}

function log(message: string) {
  console.log(`${DRY ? "[dry] " : ""}${message}`);
}

async function splitSmithIncline() {
  const day = await prisma.workoutDay.findUniqueOrThrow({ where: { dayNumber: 1 }, include: { exercises: true } });
  const incline = day.exercises.find((e) => e.name === OLD_INCLINE);
  if (!incline) {
    log("Smith split: already done");
    return;
  }

  const oldSets = await prisma.set.findMany({
    where: { exerciseId: incline.id, workoutSession: { startedAt: { lt: SMITH_SINCE } } },
    select: { id: true },
  });
  const smith = seedExercise(1, "Жим на похилій лаві в сміті (верх грудей)");
  log(`Smith split: ${oldSets.length} dumbbell sets → "${ARCHIVED_INCLINE}", exercise #${incline.id} → "${smith.name}"`);
  if (DRY) return;

  const maxOrder = Math.max(...day.exercises.map((e) => e.orderIndex));
  await prisma.$transaction(async (tx) => {
    const archived = await tx.exercise.create({
      data: {
        workoutDayId: day.id,
        name: ARCHIVED_INCLINE,
        block: incline.block,
        orderIndex: maxOrder + 1,
        targetSets: 0,
        targetRepsMin: incline.targetRepsMin,
        targetRepsMax: incline.targetRepsMax,
        bodyPart: incline.bodyPart,
        muscleGroup: incline.muscleGroup,
        exerciseType: incline.exerciseType,
        progressionMode: incline.progressionMode,
        progressionStep: incline.progressionStep,
        restTimeInSeconds: incline.restTimeInSeconds,
      },
    });
    await tx.set.updateMany({ where: { id: { in: oldSets.map((s) => s.id) } }, data: { exerciseId: archived.id } });
    await tx.exercise.update({
      where: { id: incline.id },
      data: {
        name: smith.name,
        block: smith.block,
        muscleGroup: classifyMuscleGroup(smith.name, smith.exerciseType),
        progressionStep: smith.progressionStep ?? 2.5,
        baselineWeightMin: smith.baselineWeightMin ?? null,
        baselineWeightMax: smith.baselineWeightMax ?? null,
        baselineNote: smith.baselineNote ?? null,
        technique: smith.technique ?? null,
      },
    });
  });
}

/** Підтягує підходи/техніку з сіду й додає відсутні вправи, порядок — як у сіді. */
async function syncDay(dayNumber: number, names: string[]) {
  const seedDay = workoutProgram.find((d) => d.dayNumber === dayNumber)!;
  const day = await prisma.workoutDay.findUniqueOrThrow({ where: { dayNumber }, include: { exercises: true } });

  for (const name of names) {
    const seed = seedExercise(dayNumber, name);
    const existing = day.exercises.find((e) => e.name === name && e.targetSets > 0);
    if (existing) {
      if (existing.targetSets !== seed.targetSets || existing.technique !== (seed.technique ?? null)) {
        log(`Day ${dayNumber}: "${name}" sets ${existing.targetSets} → ${seed.targetSets}`);
        if (!DRY) {
          await prisma.exercise.update({
            where: { id: existing.id },
            data: { targetSets: seed.targetSets, technique: seed.technique ?? null },
          });
        }
      }
      continue;
    }

    log(`Day ${dayNumber}: add "${name}" ${seed.targetSets}×${seed.targetRepsMin}–${seed.targetRepsMax}`);
    if (DRY) continue;
    const maxOrder = Math.max(0, ...(await prisma.exercise.findMany({ where: { workoutDayId: day.id } })).map((e) => e.orderIndex));
    await prisma.exercise.create({
      data: {
        workoutDayId: day.id,
        name: seed.name,
        block: seed.block,
        orderIndex: maxOrder + 1,
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
    });
  }

  if (DRY) return;

  // Активні вправи — у порядку сіду, архівні — після них. Через тимчасові від'ємні індекси,
  // бо (день, порядок) унікальні.
  const all = await prisma.exercise.findMany({ where: { workoutDayId: day.id }, orderBy: { orderIndex: "asc" } });
  const seedOrder = seedDay.exercises.map((e) => e.name);
  const rank = (e: (typeof all)[number]) =>
    e.targetSets > 0 && seedOrder.includes(e.name) ? seedOrder.indexOf(e.name) : seedOrder.length + e.orderIndex;
  const ordered = [...all].sort((a, b) => rank(a) - rank(b));
  await prisma.$transaction([
    ...ordered.map((e, i) => prisma.exercise.update({ where: { id: e.id }, data: { orderIndex: -(i + 1) } })),
    ...ordered.map((e, i) => prisma.exercise.update({ where: { id: e.id }, data: { orderIndex: i + 1 } })),
  ]);
}

async function main() {
  await splitSmithIncline();
  await syncDay(1, ["Канатні розгинання на трицепс у кросовері"]);
  await syncDay(3, [
    "Махи в сторони на блоці (кросовер)",
    "Молоткові підйоми (Hammer Curls)",
    "Розгинання з-за голови на блоці (трицепс)",
  ]);
  log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
