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
  const referenceWeight =
    progressionMode === "assist"
      ? Math.min(...workingSets.map((set) => set.weight))
      : Math.max(...workingSets.map((set) => set.weight));
  const lastWeight = referenceWeight;

  const topSets =
    progressionMode === "assist"
      ? workingSets.filter((set) => set.weight <= referenceWeight + 0.01)
      : workingSets.filter((set) => set.weight >= referenceWeight - 0.01);

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

  const header = exercise.block.toLowerCase().includes("розминка")
    ? "🔥 <b>Розминка</b>"
    : `🧱 <b>Без ваги</b>\n📦 ${exercise.block}`;

  let text =
    `${progressLine}${header}\n\n` +
    `<b>${exercise.name}</b>\n` +
    `Підхід ${setNumber}/${exercise.targetSets} • ${exercise.targetRepsMax} повторень\n`;

  if (exercise.technique) {
    text += `\n💡 ${exercise.technique}\n`;
  }

  text += `\n⏱️ Відпочинок між підходами: ${formatRestDuration(exercise.restTimeInSeconds ?? 60)}\n`;
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
