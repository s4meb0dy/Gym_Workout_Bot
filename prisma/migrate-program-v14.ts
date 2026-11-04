import { prisma } from "../src/db/client";
import { POSTURE_NAME, workoutProgram } from "./workout-program";

/**
 * v13 → v14: блок постави скорочено до мостика і dead bug (назва «Постава — таз і кор»),
 * тексти розминок — під сміт і штангу замість гантелей/гоблета. Підходи не змінюються.
 *
 *   npx tsx prisma/migrate-program-v14.ts --dry
 */
const DRY = process.argv.includes("--dry");
const OLD_POSTURE_NAME = "Постава — таз і грудний відділ";

function log(message: string) {
  console.log(`${DRY ? "[dry] " : ""}${message}`);
}

async function main() {
  for (const seedDay of workoutProgram) {
    const day = await prisma.workoutDay.findUniqueOrThrow({
      where: { dayNumber: seedDay.dayNumber },
      include: { exercises: true },
    });

    for (const seed of seedDay.exercises.filter((e) => e.exerciseType === "warmup")) {
      const names = seed.name === POSTURE_NAME ? [POSTURE_NAME, OLD_POSTURE_NAME] : [seed.name];
      const existing = day.exercises.find((e) => names.includes(e.name) && e.targetSets > 0);
      if (!existing) {
        log(`Day ${seedDay.dayNumber}: "${seed.name}" not found — skipped`);
        continue;
      }
      if (existing.name === seed.name && existing.technique === (seed.technique ?? null)) continue;

      log(`Day ${seedDay.dayNumber}: "${existing.name}" → "${seed.name}" (technique updated)`);
      if (!DRY) {
        await prisma.exercise.update({
          where: { id: existing.id },
          data: { name: seed.name, technique: seed.technique ?? null },
        });
      }
    }
  }
  log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
