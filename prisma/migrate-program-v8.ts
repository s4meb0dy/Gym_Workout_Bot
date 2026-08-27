import { prisma } from "../src/db/client";
import {
  classifyMuscleGroup,
  PROGRAM_VERSION,
  workoutProgram,
  WorkoutExerciseSeed,
} from "./workout-program";

/**
 * Неруйнівне застосування програми v8.
 *
 * `Set.exercise` не має onDelete, тому Prisma тримає Restrict: вправу з історією
 * підходів фізично неможливо видалити. Тому вилучені вправи не видаляються, а
 * "глушаться" — targetSets = 0. `isExerciseCompleteInSession` вважає таку вправу
 * одразу виконаною, тож у тренуванні вона не з'являється, а сети лишаються для
 * аналітики.
 */

/**
 * Старі назви -> назви у v8. Потрібні, щоб знайти існуючий рядок вправи і зберегти
 * його історію підходів замість створення дубліката. Якщо після dry-run у списку
 * "СТВОРИТИ" зʼявиться вправа, яка насправді вже існує під іншою назвою — додай її
 * тут і перезапусти.
 */
const RENAMES: Record<string, string> = {
  "Тяга верхнього блоку до грудей паралельним хватом":
    "Тяга верхнього блоку до грудей широким хватом",
  // Той самий слот литок у дні 4, назва змінювалася між версіями програми.
  "Підйоми на носки сидячи (Seated Calf Raises)":
    "Підйоми на носки в жимі ногами (Leg Press Calf Raises)",
};

const ARCHIVE_BLOCK = "Архів";
const ARCHIVE_ORDER_BASE = 900;

/**
 * Exercise має @@unique([workoutDayId, orderIndex]), тому перед перестановкою всі
 * вправи парковано на унікальний відʼємний індекс (id завжди унікальний).
 */
const parkedOrderIndex = (id: number) => -id;

interface ExistingExercise {
  id: number;
  name: string;
  workoutDayId: number;
  dayNumber: number;
  orderIndex: number;
  setCount: number;
}

interface Target {
  dayNumber: number;
  orderIndex: number;
  seed: WorkoutExerciseSeed;
}

function seedFields(seed: WorkoutExerciseSeed) {
  return {
    name: seed.name,
    block: seed.block,
    targetSets: seed.targetSets,
    targetRepsMin: seed.targetRepsMin,
    targetRepsMax: seed.targetRepsMax,
    bodyPart: seed.bodyPart,
    muscleGroup: classifyMuscleGroup(seed.name, seed.exerciseType),
    exerciseType: seed.exerciseType ?? "reps",
    progressionMode: seed.progressionMode ?? "weight",
    progressionStep: seed.progressionStep ?? 2,
    restTimeInSeconds: seed.restTimeInSeconds,
    technique: seed.technique ?? null,
  };
}

function baselineFields(seed: WorkoutExerciseSeed) {
  return {
    baselineWeightMin: seed.baselineWeightMin ?? null,
    baselineWeightMax: seed.baselineWeightMax ?? null,
    baselineNote: seed.baselineNote ?? null,
  };
}

export async function migrateProgramToV8({ dryRun = false } = {}) {
  const days = await prisma.workoutDay.findMany({
    orderBy: { dayNumber: "asc" },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: { _count: { select: { sets: true } } },
      },
    },
  });

  if (days.length === 0) {
    console.log("Програми в БД немає. Використай `npm run db:seed` для першого засіву.");
    return { applied: false };
  }

  const existing: ExistingExercise[] = [];
  for (const day of days) {
    for (const exercise of day.exercises) {
      existing.push({
        id: exercise.id,
        name: RENAMES[exercise.name] ?? exercise.name,
        workoutDayId: exercise.workoutDayId,
        dayNumber: day.dayNumber,
        orderIndex: exercise.orderIndex,
        setCount: exercise._count.sets,
      });
    }
  }

  const setsBefore = await prisma.set.count();

  const byName = new Map<string, ExistingExercise[]>();
  for (const exercise of existing) {
    const list = byName.get(exercise.name) ?? [];
    list.push(exercise);
    byName.set(exercise.name, list);
  }

  const claimed = new Map<number, Target>();
  const creates: Target[] = [];

  for (const day of workoutProgram) {
    day.exercises.forEach((seed, index) => {
      const orderIndex = index + 1;
      const free = (byName.get(seed.name) ?? []).filter((c) => !claimed.has(c.id));

      // Вправа може існувати в кількох днях (прес стояв у всіх чотирьох). Беремо
      // рядок з того самого дня, інакше — з найбагатшою історією.
      const pick =
        free.find((c) => c.dayNumber === day.dayNumber) ??
        [...free].sort((a, b) => b.setCount - a.setCount)[0];

      if (pick) {
        claimed.set(pick.id, { dayNumber: day.dayNumber, orderIndex, seed });
      } else {
        creates.push({ dayNumber: day.dayNumber, orderIndex, seed });
      }
    });
  }

  const archived = existing.filter((exercise) => !claimed.has(exercise.id));
  const byId = new Map(existing.map((exercise) => [exercise.id, exercise]));

  // ---- Звіт ----
  console.log(`\n=== Міграція програми до v${PROGRAM_VERSION}${dryRun ? " (DRY RUN)" : ""} ===\n`);

  for (const day of workoutProgram) {
    console.log(`День ${day.dayNumber} — ${day.name} (${day.weekday})`);
    day.exercises.forEach((seed, index) => {
      const entry = [...claimed.entries()].find(
        ([, target]) => target.seed === seed && target.dayNumber === day.dayNumber,
      );
      if (!entry) {
        console.log(`  ${index + 1}. + СТВОРИТИ  ${seed.name}`);
        return;
      }
      const source = byId.get(entry[0]);
      const moved = source && source.dayNumber !== day.dayNumber;
      const history = source?.setCount ? ` [історія: ${source.setCount} сетів]` : "";
      const movedFrom = moved ? ` (перенесено з дня ${source?.dayNumber})` : "";
      console.log(`  ${index + 1}. ${moved ? "→ ПЕРЕНОС " : "  лишається"} ${seed.name}${movedFrom}${history}`);
    });
    console.log("");
  }

  if (archived.length > 0) {
    console.log("Вилучено з програми (targetSets = 0, історія збережена):");
    for (const exercise of archived) {
      console.log(`  🗄️  ${exercise.name} (день ${exercise.dayNumber}) [${exercise.setCount} сетів]`);
    }
    console.log("");
  }

  console.log(
    `Активних вправ: ${claimed.size + creates.length} • нових: ${creates.length} • ` +
      `в архів: ${archived.length} • сетів у БД: ${setsBefore}\n`,
  );

  if (dryRun) {
    console.log("DRY RUN — жодних змін не внесено. Запусти без --dry, щоб застосувати.\n");
    return { applied: false };
  }

  // ---- Застосування ----
  await prisma.$transaction(async (tx) => {
    for (const day of workoutProgram) {
      await tx.workoutDay.upsert({
        where: { dayNumber: day.dayNumber },
        update: { name: day.name, weekday: day.weekday },
        create: { dayNumber: day.dayNumber, name: day.name, weekday: day.weekday },
      });
    }

    const dayIdByNumber = new Map(
      (await tx.workoutDay.findMany({ select: { id: true, dayNumber: true } })).map(
        (day) => [day.dayNumber, day.id] as const,
      ),
    );

    // Крок 1: звільнити всі orderIndex, щоб не впертися в unique-констрейнт.
    for (const exercise of existing) {
      await tx.exercise.update({
        where: { id: exercise.id },
        data: { orderIndex: parkedOrderIndex(exercise.id) },
      });
    }

    // Крок 2: розставити вправи, що залишаються в програмі.
    for (const [id, target] of claimed) {
      const source = byId.get(id);
      const workoutDayId = dayIdByNumber.get(target.dayNumber);
      if (!workoutDayId) continue;

      await tx.exercise.update({
        where: { id },
        data: {
          workoutDayId,
          orderIndex: target.orderIndex,
          ...seedFields(target.seed),
          // Якщо історія вже є — прогресія рахується з неї, а baseline міг бути
          // виправлений через бота. Не перетираємо.
          ...(source && source.setCount > 0 ? {} : baselineFields(target.seed)),
        },
      });
    }

    // Крок 3: нові вправи.
    for (const target of creates) {
      const workoutDayId = dayIdByNumber.get(target.dayNumber);
      if (!workoutDayId) continue;

      await tx.exercise.create({
        data: {
          workoutDayId,
          orderIndex: target.orderIndex,
          ...seedFields(target.seed),
          ...baselineFields(target.seed),
        },
      });
    }

    // Крок 4: архів — лишається на своєму дні, але з нульовими підходами.
    const perDay = new Map<number, number>();
    for (const exercise of archived) {
      const offset = perDay.get(exercise.workoutDayId) ?? 0;
      perDay.set(exercise.workoutDayId, offset + 1);
      await tx.exercise.update({
        where: { id: exercise.id },
        data: {
          targetSets: 0,
          block: ARCHIVE_BLOCK,
          orderIndex: ARCHIVE_ORDER_BASE + offset,
        },
      });
    }
  });

  const setsAfter = await prisma.set.count();
  if (setsAfter !== setsBefore) {
    throw new Error(`Історія підходів змінилась: було ${setsBefore}, стало ${setsAfter}.`);
  }

  console.log(`✅ Програму v${PROGRAM_VERSION} застосовано. Історія збережена: ${setsAfter} сетів.\n`);
  return { applied: true };
}

if (require.main === module) {
  migrateProgramToV8({ dryRun: process.argv.includes("--dry") })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
