export type BodyPart = "upper" | "lower";
export type ProgressionMode = "weight" | "assist";
export type ExerciseType = "reps" | "time" | "warmup";

export interface SetResult {
  weight: number;
  reps: number;
}

export interface ExerciseBaseline {
  baselineWeightMin?: number | null;
  baselineWeightMax?: number | null;
  baselineNote?: string | null;
  progressionMode?: ProgressionMode;
  progressionStep?: number;
  exerciseType?: ExerciseType;
}

export interface ProgressionResult {
  lastWeight: number;
  lastReps: number;
  lastSets: SetResult[];
  suggestedWeight: number;
  shouldIncreaseWeight: boolean;
  message: string;
}

export const MANUAL_WEIGHT_HINT =
  "\n\n✏️ <i>Можеш ввести будь-яку фактичну вагу — якщо в залі немає рекомендованого номіналу, просто запиши те, що взяли.</i>";

export function getBaselineWeight(baseline: ExerciseBaseline): number {
  if (baseline.baselineWeightMin != null && baseline.baselineWeightMax != null) {
    if (baseline.baselineWeightMin === baseline.baselineWeightMax) {
      return baseline.baselineWeightMin;
    }
    return (baseline.baselineWeightMin + baseline.baselineWeightMax) / 2;
  }
  if (baseline.baselineWeightMin != null) {
    return baseline.baselineWeightMin;
  }
  if (baseline.baselineWeightMax != null) {
    return baseline.baselineWeightMax;
  }
  return 0;
}

/**
 * Робоча противага в Гравітоні. Перший підхід часто йде без противаги (у логах це
 * 1 кг, бо нуль ввести не можна), тому абсолютний мінімум завищував рівень і
 * прогресія пропонувала неможливу вагу. Беремо противагу, з якою зроблено
 * більшість підходів; за нічиєї — меншу.
 */
export function getAssistReferenceWeight(sets: SetResult[]): number {
  const counts = new Map<number, number>();
  for (const set of sets) {
    counts.set(set.weight, (counts.get(set.weight) ?? 0) + 1);
  }

  let reference = sets[0]?.weight ?? 0;
  let bestCount = 0;
  for (const [weight, count] of counts) {
    if (count > bestCount || (count === bestCount && weight < reference)) {
      reference = weight;
      bestCount = count;
    }
  }
  return reference;
}

export function getReferenceWeight(sets: SetResult[], progressionMode: ProgressionMode): number {
  if (sets.length === 0) {
    return 0;
  }
  return progressionMode === "assist"
    ? getAssistReferenceWeight(sets)
    : Math.max(...sets.map((set) => set.weight));
}

export function formatRepTarget(min: number, max: number, exerciseType: ExerciseType): string {
  if (exerciseType === "warmup") {
    return `${max} повторень (без ваги)`;
  }
  if (exerciseType === "time") {
    return `${min} сек`;
  }
  if (min === max) {
    return `${min} повторень`;
  }
  return `${min}–${max} повторень`;
}

function formatProgressionHint(
  progressionMode: ProgressionMode,
  progressionStep: number,
): string {
  if (progressionMode === "assist") {
    return `Менша противага = складніше (крок прогресії: −${formatWeight(progressionStep)} кг).`;
  }
  return `Після досягнення верхньої межі повторень — +${formatWeight(progressionStep)} кг.`;
}

function buildFirstWorkoutMessage(
  baseline: ExerciseBaseline,
  targetRepsMin: number,
  targetRepsMax: number,
  exerciseType: ExerciseType,
): ProgressionResult {
  const repTarget = formatRepTarget(targetRepsMin, targetRepsMax, exerciseType);
  const suggestedWeight = getBaselineWeight(baseline);
  const progressionMode = baseline.progressionMode ?? "weight";
  const progressionStep = baseline.progressionStep ?? 2;
  const isAssist = progressionMode === "assist";

  if (baseline.baselineNote) {
    const unit = isAssist ? "противага" : "вага";

    return {
      lastWeight: 0,
      lastReps: 0,
      lastSets: [],
      suggestedWeight,
      shouldIncreaseWeight: false,
      message:
        `Перше тренування цієї вправи.\n` +
        `Орієнтир: ${baseline.baselineNote} (${unit}).\n` +
        `Ціль: ${repTarget}.\n` +
        formatProgressionHint(progressionMode, progressionStep) +
        MANUAL_WEIGHT_HINT,
    };
  }

  const inputHint =
    exerciseType === "time"
      ? "Вводь: <code>вага x секунди</code> (наприклад, <code>20x45</code>)"
      : "Обери комфортну робочу вагу та виконай цільові повторення";

  return {
    lastWeight: 0,
    lastReps: 0,
    lastSets: [],
    suggestedWeight: 0,
    shouldIncreaseWeight: false,
    message: `Перше тренування цієї вправи.\nЦіль: ${repTarget}.\n${inputHint}${MANUAL_WEIGHT_HINT}`,
  };
}

export function calculateProgression(
  lastSets: SetResult[],
  targetSets: number,
  targetRepsMin: number,
  targetRepsMax: number,
  baseline: ExerciseBaseline = {},
): ProgressionResult {
  const exerciseType = baseline.exerciseType ?? "reps";
  const progressionMode = baseline.progressionMode ?? "weight";
  const progressionStep = baseline.progressionStep ?? 2;
  const repTarget = formatRepTarget(targetRepsMin, targetRepsMax, exerciseType);
  const unit = progressionMode === "assist" ? "противага" : "вага";
  const repUnit = exerciseType === "time" ? "сек" : "повторень";

  if (lastSets.length === 0) {
    return buildFirstWorkoutMessage(baseline, targetRepsMin, targetRepsMax, exerciseType);
  }

  // Підходи вже відсортовані за setNumber ASC; беремо робочі (не більше targetSets).
  const workingSets = lastSets.slice(0, targetSets);
  const lastSet = workingSets[workingSets.length - 1]!;
  const lastReps = lastSet.reps;

  // Робоча вага для прогресії — найважчий підхід (не останній, якщо там backoff).
  const referenceWeight = getReferenceWeight(workingSets, progressionMode);
  const lastWeight = referenceWeight;

  const topSets = workingSets.filter((set) => Math.abs(set.weight - referenceWeight) < 0.01);

  const allHitMax =
    topSets.length >= targetSets && topSets.every((set) => set.reps >= targetRepsMax);

  if (allHitMax) {
    if (progressionMode === "assist") {
      const suggestedWeight = Math.max(0, lastWeight - progressionStep);
      return {
        lastWeight,
        lastReps,
        lastSets: workingSets,
        suggestedWeight,
        shouldIncreaseWeight: true,
        message:
          `Минулого разу ${unit} була ${formatWeight(lastWeight)} кг на ${lastReps} ${repUnit}.\n` +
          `Сьогодні ціль: зменшити противагу до ${formatWeight(suggestedWeight)} кг (−${formatWeight(progressionStep)} кг, ${repTarget}).` +
          MANUAL_WEIGHT_HINT,
      };
    }

    const suggestedWeight = lastWeight + progressionStep;
    return {
      lastWeight,
      lastReps,
      lastSets: workingSets,
      suggestedWeight,
      shouldIncreaseWeight: true,
      message:
        `Минулого разу робоча вага була ${formatWeight(lastWeight)} кг на ${lastReps} ${repUnit}.\n` +
        `Сьогодні ціль: ${formatWeight(suggestedWeight)} кг (+${formatWeight(progressionStep)} кг, ${repTarget}).` +
        MANUAL_WEIGHT_HINT,
    };
  }

  return {
    lastWeight,
    lastReps,
    lastSets: workingSets,
    suggestedWeight: lastWeight,
    shouldIncreaseWeight: false,
    message:
      `Минулого разу ${unit} була ${formatWeight(lastWeight)} кг на ${lastReps} ${repUnit}.\n` +
      `Сьогодні ціль: залишити ${formatWeight(lastWeight)} кг і зробити більше (${repTarget}).` +
      MANUAL_WEIGHT_HINT,
  };
}

export interface ParsedSet {
  weight: number;
  reps: number;
  rpe?: number;
  note?: string;
}

export function parseSetInput(
  text: string,
  exerciseType: ExerciseType = "reps",
  fallbackWeight?: number,
): ParsedSet | null {
  const maxReps = exerciseType === "time" ? 600 : 100;
  let rest = text.trim().replace(/,/g, ".").replace(/[хХxX×*]/g, " ");

  let rpe: number | undefined;
  const rpeMatch = rest.match(/@\s*(\d+(?:\.\d+)?)/);
  if (rpeMatch) {
    const value = parseFloat(rpeMatch[1]);
    if (value > 0 && value <= 10) {
      rpe = value;
    }
    rest = rest.replace(rpeMatch[0], " ").trim();
  }

  const nums = rest.match(/\d+(?:\.\d+)?/g) ?? [];
  const note =
    rest
      .replace(/\d+(?:\.\d+)?/g, " ")
      .trim()
      .slice(0, 200) || undefined;

  let weight: number;
  let reps: number;

  if (nums.length >= 2) {
    const w = nums[0];
    const r = nums[1];
    if (!w || !r) {
      return null;
    }
    weight = parseFloat(w);
    reps = parseInt(r, 10);
  } else if (nums.length === 1 && fallbackWeight != null && fallbackWeight > 0) {
    const r = nums[0];
    if (!r) {
      return null;
    }
    reps = parseInt(r, 10);
    if (exerciseType !== "time" && reps > 50) {
      return null;
    }
    weight = fallbackWeight;
  } else {
    return null;
  }

  if (weight <= 0 || reps <= 0 || reps > maxReps) {
    return null;
  }

  return { weight, reps, rpe, note };
}

export function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
}

export function calculateTonnage(sets: SetResult[]): number {
  return sets.reduce((total, set) => total + set.weight * set.reps, 0);
}

export function isWarmupExercise(exercise: { exerciseType: string }): boolean {
  return exercise.exerciseType === "warmup";
}

export function formatWarmupPrompt(
  exercise: {
    name: string;
    block: string;
    targetSets: number;
    targetRepsMax: number;
    restTimeInSeconds?: number;
    technique?: string | null;
  },
  setNumber: number,
  exerciseIndex?: number,
  totalExercises?: number,
): string {
  const progressLine =
    exerciseIndex && totalExercises ? `📍 Вправа ${exerciseIndex}/${totalExercises}\n` : "";

  const block = exercise.block.toLowerCase();
  const isPosture = block.includes("постава");
  const header = block.includes("розминка")
    ? "🔥 <b>Розминка</b>"
    : isPosture
      ? "🧘 <b>Постава</b>"
      : `🧱 <b>Без ваги</b>\n📦 ${exercise.block}`;

  // Розминка-чекліст — один "підхід" на весь список, тому рахунок повторень
  // і таймер відпочинку тут лише шум.
  const isChecklist = exercise.targetSets === 1 && exercise.targetRepsMax <= 1;

  let text = `${progressLine}${header}\n\n` + `<b>${exercise.name}</b>\n`;
  text += isChecklist
    ? `Пройди всі пункти по черзі — це ${isPosture ? "≈6 хвилин" : "3–5 хвилин"}.\n`
    : `Підхід ${setNumber}/${exercise.targetSets} • ${exercise.targetRepsMax} повторень\n`;

  if (exercise.technique) {
    text += `\n💡 ${exercise.technique}\n`;
  }

  const rest = exercise.restTimeInSeconds ?? 60;
  if (rest > 0) {
    text += `\n⏱️ Відпочинок між підходами: ${formatRestDuration(rest)}\n`;
  }

  text += `\nНатисни «✅ Підхід виконано», коли завершиш.`;
  return text;
}

export function formatRestDuration(seconds: number): string {
  if (seconds >= 60) {
    const minutes = seconds / 60;
    return `${seconds} сек (${minutes} хв)`;
  }
  return `${seconds} сек`;
}

export function formatProgressionLabel(
  progressionMode: string,
  progressionStep: number,
): string {
  if (progressionMode === "assist") {
    return `Прогресія: −${formatWeight(progressionStep)} кг противаги`;
  }
  return `Прогресія: +${formatWeight(progressionStep)} кг`;
}
