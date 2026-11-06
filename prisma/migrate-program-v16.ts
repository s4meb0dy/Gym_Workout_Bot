import { prisma } from "../src/db/client";
import { classifyMuscleGroup, workoutProgram } from "./workout-program";

/**
 * v15 → v16, Верх B без втрати історії (груди відстають — 13 → 16 підходів на тиждень):
 * - новий жим гантелей на похилій лаві одразу після підтягувань;
 * - Cable Fly → зведення знизу вгору (верх грудей), старе — в архів з історією;
 * - розгинання з-за голови → архів (трицепс і так працює в жимах і брусах);
 * - техніка молоткових без згадки про суперсет.
 * Ідемпотентний: порядок вправ дня вирівнюється за сідом.
 *
 *   npx tsx prisma/migrate-program-v16.ts --dry
 */
const DRY = process.argv.includes("--dry");
const DAY = 3;
const ARCHIVE = ["Зведення рук у кросовері (Cable Fly)", "Розгинання з-за голови на блоці (трицепс)"];

function log(message: string) {
  console.log(`${DRY ? "[dry] " : ""}${message}`);
}

async function main() {
  const seedDay = workoutProgram.find((d) => d.dayNumber === DAY);
  if (!seedDay) throw new Error(`Day ${DAY} not in seed`);
  const day = await prisma.workoutDay.findUniqueOrThrow({ where: { dayNumber: DAY }, include: { exercises: true } });

  const active = day.exercises.filter((e) => e.targetSets > 0);
  const toArchive = active.filter((e) => ARCHIVE.includes(e.name));
  const missing = seedDay.exercises.filter((s) => !active.some((e) => e.name === s.name));
  const unknown = active.filter((e) => !ARCHIVE.includes(e.name) && !seedDay.exercises.some((s) => s.name === e.name));
  if (unknown.length) throw new Error(`Unexpected active exercises: ${unknown.map((e) => e.name).join(", ")}`);

  for (const e of toArchive) log(`archive "${e.name}"`);
  for (const s of missing) log(`add "${s.name}" ${s.targetSets}×${s.targetRepsMin}–${s.targetRepsMax}`);
  if (DRY) {
    log("Done.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Унікальний індекс (день, порядок): спершу відсуваємо всі вправи дня далеко вниз.
    const maxOrder = Math.max(...day.exercises.map((e) => e.orderIndex));
    for (const e of day.exercises) {
      await tx.exercise.update({ where: { id: e.id }, data: { orderIndex: e.orderIndex + maxOrder + 1000 } });
    }

    for (const e of toArchive) {
      await tx.exercise.update({ where: { id: e.id }, data: { targetSets: 0 } });
    }

    for (const s of missing) {
      await tx.exercise.create({
        data: {
          workoutDayId: day.id,
          name: s.name,
          block: s.block,
          orderIndex: -1 - missing.indexOf(s),
          targetSets: s.targetSets,
          targetRepsMin: s.targetRepsMin,
          targetRepsMax: s.targetRepsMax,
          bodyPart: s.bodyPart,
          muscleGroup: classifyMuscleGroup(s.name, s.exerciseType),
          exerciseType: s.exerciseType ?? "reps",
          progressionMode: s.progressionMode ?? "weight",
          progressionStep: s.progressionStep ?? 2,
          restTimeInSeconds: s.restTimeInSeconds,
          baselineWeightMin: s.baselineWeightMin ?? null,
          baselineWeightMax: s.baselineWeightMax ?? null,
          baselineNote: s.baselineNote ?? null,
          technique: s.technique ?? null,
        },
      });
    }

    // Активні — у порядку сіду (з технікою з сіду), архівні — після них.
    const all = await tx.exercise.findMany({ where: { workoutDayId: day.id }, orderBy: { orderIndex: "asc" } });
    let order = 1;
    for (const s of seedDay.exercises) {
      const e = all.find((x) => x.name === s.name && x.targetSets > 0);
      if (!e) throw new Error(`"${s.name}" missing after insert`);
      await tx.exercise.update({ where: { id: e.id }, data: { orderIndex: order++, technique: s.technique ?? null } });
    }
    for (const e of all.filter((x) => x.targetSets === 0)) {
      await tx.exercise.update({ where: { id: e.id }, data: { orderIndex: order++ } });
    }
  });

  const result = await prisma.exercise.findMany({ where: { workoutDayId: day.id, targetSets: { gt: 0 } }, orderBy: { orderIndex: "asc" } });
  for (const e of result) log(`#${e.orderIndex} ${e.name} ${e.targetSets}×${e.targetRepsMin}–${e.targetRepsMax}`);
  log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
