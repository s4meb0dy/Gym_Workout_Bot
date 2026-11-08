import { ExerciseView } from "./api";

export function fmtWeight(w: number): string {
  return Number.isInteger(w) ? String(w) : w.toFixed(1).replace(/\.0$/, "");
}

export function fmtTarget(ex: ExerciseView): string {
  if (ex.type === "time") return `${ex.targetSets} × ${ex.targetRepsMin} с`;
  if (ex.type === "warmup") return ex.targetSets > 1 ? `${ex.targetSets} × ${ex.targetRepsMax}` : "чек-лист";
  const reps = ex.targetRepsMin === ex.targetRepsMax ? `${ex.targetRepsMin}` : `${ex.targetRepsMin}–${ex.targetRepsMax}`;
  return `${ex.targetSets} × ${reps}`;
}

export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Гравітон: 1 кг противаги = підхід з власною вагою (див. ASSIST_BODYWEIGHT на сервері). */
export function isBodyweight(weight: number, mode?: string): boolean {
  return mode === "assist" && weight <= 1.01;
}

export function fmtSetWeight(weight: number, mode?: string): string {
  return isBodyweight(weight, mode) ? "ВВ" : fmtWeight(weight);
}

/** Повторення підходу; дотиснуті після паузи — через «+»: 5+2. */
export function fmtReps(s: { reps: number; extraReps?: number }): string {
  return s.extraReps ? `${s.reps}+${s.extraReps}` : `${s.reps}`;
}

export function fmtSets(sets: Array<{ weight: number; reps: number; extraReps?: number }>, mode?: string): string {
  return sets.map((s) => (s.weight > 0 ? `${fmtSetWeight(s.weight, mode)}×${fmtReps(s)}` : fmtReps(s))).join("  ");
}

export function daysAgo(iso: string | null): string {
  if (!iso) return "ще не було";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "сьогодні";
  if (days === 1) return "вчора";
  return `${days} дн. тому`;
}

const SHORT_WEEKDAYS: Record<string, string> = {
  "Понеділок": "Пн",
  "Вівторок": "Вт",
  "Середа": "Ср",
  "Четвер": "Чт",
  "П'ятниця": "Пт",
  "Субота": "Сб",
  "Неділя": "Нд",
};

export function shortWeekday(weekday: string): string {
  return SHORT_WEEKDAYS[weekday] ?? weekday.slice(0, 2);
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Date(iso).toLocaleDateString("uk-UA", opts);
}

export function fmtNumber(n: number): string {
  return Math.round(n).toLocaleString("uk-UA");
}

export function fmtRest(seconds: number): string {
  if (seconds <= 0) return "без відпочинку";
  if (seconds < 60) return `${seconds} с`;
  return seconds % 60 === 0 ? `${seconds / 60} хв` : `${Math.floor(seconds / 60)} хв ${seconds % 60} с`;
}

export function isDone(ex: ExerciseView): boolean {
  return ex.sets.length >= ex.targetSets;
}

export function unitLabel(ex: ExerciseView): string {
  return ex.type === "time" ? "сек" : "повт";
}
