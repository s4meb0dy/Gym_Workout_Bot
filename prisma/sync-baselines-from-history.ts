import { prisma } from "../src/db/client";
import type { Exercise } from "@prisma/client";
import { getReferenceWeight, ProgressionMode } from "../src/services/progression";

function referenceWeight(
  exercise: Exercise,
  sets: Array<{ weight: number; reps: number }>,
): number {
  const working = sets.slice(0, Math.max(exercise.targetSets, 1));
  return getReferenceWeight(working, exercise.progressionMode as ProgressionMode);
}

function formatBaselineNote(exercise: Exercise, weight: number): string {
  const old = exercise.baselineNote ?? "";
  if (exercise.progressionMode === "assist") {
    return `противага ${weight} кг`;
  }
  if (old.includes("на сторону")) {
    return `${weight} кг на сторону`;
  }
  if (/2[×x]/i.test(old)) {
    return `2×${weight} кг`;
  }
  return `${weight} кг`;
}

export async function syncBaselinesFromHistory({ dryRun = false } = {}) {
  const exercises = await prisma.exercise.findMany({
    where: { targetSets: { gt: 0 } },
    orderBy: [{ workoutDayId: "asc" }, { orderIndex: "asc" }],
    include: { workoutDay: true },
  });

  console.log(`\n=== Синхронізація орієнтирів з історії${dryRun ? " (DRY RUN)" : ""} ===\n`);

  let updated = 0;

  for (const exercise of exercises) {
    const lastSession = await prisma.workoutSession.findFirst({
      where: {
        completedAt: { not: null },
        sets: {
          some: { exerciseId: exercise.id, weight: { gt: 0 }, reps: { gt: 0 } },
        },
      },
      orderBy: { completedAt: "desc" },
      include: {
        sets: {
          where: { exerciseId: exercise.id, weight: { gt: 0 }, reps: { gt: 0 } },
          orderBy: [{ setNumber: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!lastSession?.sets.length) {
      console.log(`  — ${exercise.name}: немає історії, лишається ${exercise.baselineNote ?? "—"}`);
      continue;
    }

    const weight = referenceWeight(exercise, lastSession.sets);
    if (weight <= 0) {
      continue;
    }

    const note = formatBaselineNote(exercise, weight);
    const unchanged =
      exercise.baselineWeightMin === weight &&
      exercise.baselineWeightMax === weight &&
      exercise.baselineNote === note;

    if (unchanged) {
      console.log(`  ✓ ${exercise.name}: ${note}`);
      continue;
    }

    console.log(
      `  ↑ День ${exercise.workoutDay.dayNumber} • ${exercise.name}\n` +
        `    було: ${exercise.baselineNote ?? "—"} (${exercise.baselineWeightMin ?? "?"})\n` +
        `    стане: ${note} (${weight} кг)`,
    );

    if (!dryRun) {
      await prisma.exercise.update({
        where: { id: exercise.id },
        data: {
          baselineWeightMin: weight,
          baselineWeightMax: weight,
          baselineNote: note,
        },
      });
    }
    updated += 1;
  }

  console.log(`\n${dryRun ? "Буде оновлено" : "Оновлено"}: ${updated} вправ.\n`);
  return { updated };
}

if (require.main === module) {
  syncBaselinesFromHistory({ dryRun: process.argv.includes("--dry") })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
