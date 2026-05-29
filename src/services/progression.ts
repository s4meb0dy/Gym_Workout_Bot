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
  suggestedWeight: number;
  shouldIncreaseWeight: boolean;
  message: string;
}

export const MANUAL_WEIGHT_HINT =
  "\n\n✏️ <i>Можеш ввести будь-яку фактичну вагу — якщо в залі немає рекомендованого номіналу, просто запиши те, що взяли.</i>";

function getBaselineWeight(baseline: ExerciseBaseline): number {
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

function formatRepTarget(min: number, max: number, exerciseType: ExerciseType): string {
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
  _bodyPart: BodyPart,
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

  const workingSets = lastSets.slice(0, targetSets);
  const lastSet = workingSets[workingSets.length - 1];
  const lastWeight = lastSet.weight;
  const lastReps = lastSet.reps;

  const allSetsCompleted = workingSets.length >= targetSets;
  const allHitMax =
    allSetsCompleted && workingSets.every((set) => set.reps >= targetRepsMax);

  if (allHitMax) {
    if (progressionMode === "assist") {
      const suggestedWeight = Math.max(0, lastWeight - progressionStep);
      return {
        lastWeight,
        lastReps,
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
): ParsedSet | null {
  const normalized = text.trim().replace(/,/g, ".").replace(/[хХ×]/g, "x");
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*[xX]\s*(\d+)(.*)$/);

  if (!match) {
    return null;
  }

  const weight = parseFloat(match[1]);
  const reps = parseInt(match[2], 10);
  const maxReps = exerciseType === "time" ? 600 : 100;

  if (weight <= 0 || reps <= 0 || reps > maxReps) {
    return null;
  }

  let rest = (match[3] ?? "").trim();
  let rpe: number | undefined;

  const rpeMatch = rest.match(/@\s*(\d+(?:\.\d+)?)/);
  if (rpeMatch) {
    const value = parseFloat(rpeMatch[1]);
    if (value > 0 && value <= 10) {
      rpe = value;
    }
    rest = rest.replace(rpeMatch[0], "").trim();
  }

  const note = rest.length > 0 ? rest.slice(0, 200) : undefined;

  return { weight, reps, rpe, note };
}

export function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
}

export function calculateTonnage(sets: SetResult[]): number {
  return sets.reduce((total, set) => total + set.weight * set.reps, 0);
}

export function formatExerciseTarget(
  targetRepsMin: number,
  targetRepsMax: number,
  exerciseType: ExerciseType,
): string {
  return formatRepTarget(targetRepsMin, targetRepsMax, exerciseType);
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

  let text =
    `${progressLine}🔥 <b>Розминка</b>\n📦 ${exercise.block}\n\n` +
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
  if (seconds >= 120 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${seconds} сек (${minutes} хв)`;
  }
  if (seconds === 90) {
    return "90 сек (1.5 хв)";
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds} сек (${seconds / 60} хв)`;
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
