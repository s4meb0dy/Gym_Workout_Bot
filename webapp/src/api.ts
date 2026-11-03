import { tg } from "./telegram";

export interface SetView {
  id: string;
  setNumber: number;
  weight: number;
  reps: number;
}

export interface ExerciseView {
  id: number;
  name: string;
  block: string;
  type: "reps" | "time" | "warmup";
  progressionMode: "weight" | "assist";
  progressionStep: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds: number;
  technique: string | null;
  sets: SetView[];
  lastSets: Array<{ weight: number; reps: number }>;
  suggestedWeight: number;
  shouldIncrease: boolean;
  stalledWeight: number | null;
}

export interface WorkoutView {
  sessionId: string;
  startedAt: string;
  day: { dayNumber: number; weekday: string; name: string };
  exercises: ExerciseView[];
}

export interface DayView {
  dayNumber: number;
  weekday: string;
  name: string;
  exerciseCount: number;
  isToday: boolean;
  lastCompletedAt: string | null;
}

export interface Summary {
  totalSets: number;
  tonnage: number;
  durationMinutes: number;
  dayName: string;
  records: Array<{ exerciseName: string; weight: number; reps: number; note?: string }>;
}

export interface ProgramExercise {
  id: number;
  name: string;
  block: string;
  type: "reps" | "time" | "warmup";
  progressionMode: "weight" | "assist";
  progressionStep: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds: number;
  technique: string | null;
  muscleGroup: string;
  workingWeight: number | null;
  nextWeight: number | null;
  hasHistory: boolean;
}

export interface ProgramDay {
  dayNumber: number;
  weekday: string;
  name: string;
  exercises: ProgramExercise[];
}

export interface ExerciseUpdate {
  name?: string;
  targetSets?: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
  restSeconds?: number;
  progressionStep?: number;
  technique?: string;
}

export interface HistoryItem {
  id: string;
  completedAt: string;
  dayName: string;
  weekday: string;
  durationMinutes: number;
  sets: number;
  tonnage: number;
}

export interface HistoryDetail {
  id: string;
  completedAt: string;
  dayName: string;
  durationMinutes: number;
  tonnage: number;
  exercises: Array<{
    exerciseId: number;
    name: string;
    progressionMode: string;
    sets: Array<{ weight: number; reps: number }>;
  }>;
}

export interface ProgressData {
  weeks: Array<{ weekStart: string; workouts: number; sets: number; tonnage: number }>;
  volume: Array<{ muscleGroup: string; sets: number; tonnage: number }>;
  exercises: Array<{ exerciseId: number; name: string; sessions: number }>;
}

export interface OneRmPoint {
  date: string;
  oneRm: number;
  bestWeight: number;
  bestReps: number;
}

export interface Macros {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface FoodEntry extends Macros {
  id: string;
  label: string;
}

export type Goal = "lean_bulk" | "maintain" | "cut";

export type Energy =
  | {
      missing: true;
      goal: Goal;
      weighIns: number;
      loggedDays: number;
      hint: string;
    }
  | {
      missing?: undefined;
      tdee: number;
      avgIntake: number;
      weeklyChangeKg: number;
      latestWeightKg: number;
      periodDays: number;
      loggedDays: number;
      weighIns: number;
      confidence: "high" | "medium" | "low";
      goal: Goal;
      targetWeeklyChangeKg: number;
      recommendedCalories: number;
      pace: "below" | "on_track" | "above";
    };

export interface Measurement {
  id: string;
  date: string;
  waistCm: number | null;
  chestCm: number | null;
  shouldersCm: number | null;
  armCm: number | null;
  thighCm: number | null;
}

export type MeasurementField = "waistCm" | "chestCm" | "shouldersCm" | "armCm" | "thighCm";

export interface DayData {
  date: string;
  isToday: boolean;
  targets: { calories: number; protein: number; fat: number; carbs: number };
  recommendedSplit: { calories: number; protein: number; fat: number; carbs: number } | null;
  macros: Macros;
  entries: FoodEntry[];
  previousEntries: FoodEntry[];
  recentFoods: Array<Macros & { label: string }>;
  weight: { points: Array<{ id: string; date: string; weightKg: number }> };
  energy: Energy;
  measurements: { entries: Measurement[]; insight: string | null; due: boolean; daysSinceLast: number | null };
  profile: { heightCm: number | null; goal: Goal; weighInReminder: boolean; weighInHour: number };
  health: {
    sleepMinutes: number | null;
    restingHr: number | null;
    hrv: number | null;
    steps: number | null;
    activeCalories: number | null;
    source: string;
  } | null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (tg?.initData) headers.Authorization = `tma ${tg.initData}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api/app${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(res.status === 401 ? "Немає доступу" : `Помилка сервера (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  state: () =>
    request<{
      firstName: string | null;
      days: DayView[];
      workout: WorkoutView | null;
      deload: { weeksInARow: number; due: boolean; advice: string | null };
    }>("GET", "/state"),
  start: (dayNumber: number) => request<{ workout: WorkoutView }>("POST", "/workout/start", { dayNumber }),
  logSet: (exerciseId: number, weight: number, reps: number) =>
    request<{ workout: WorkoutView; restSeconds: number; record: string | null }>("POST", "/workout/sets", {
      exerciseId,
      weight,
      reps,
    }),
  updateSet: (id: string, weight: number, reps: number) =>
    request<{ workout: WorkoutView }>("PATCH", `/workout/sets/${id}`, { weight, reps }),
  deleteSet: (id: string) => request<{ workout: WorkoutView }>("DELETE", `/workout/sets/${id}`),
  cancelRest: () => request<{ ok: true }>("POST", "/workout/rest/cancel"),
  finish: () => request<{ summary: Summary }>("POST", "/workout/finish"),
  cancel: () => request<{ ok: true }>("POST", "/workout/cancel"),

  program: () => request<{ days: ProgramDay[] }>("GET", "/program"),
  updateExercise: (id: number, update: ExerciseUpdate) =>
    request<{ days: ProgramDay[] }>("PATCH", `/program/exercises/${id}`, update),
  moveExercise: (id: number, direction: "up" | "down") =>
    request<{ days: ProgramDay[] }>("POST", `/program/exercises/${id}/move`, { direction }),
  addExercise: (dayNumber: number, name: string) =>
    request<{ days: ProgramDay[]; createdId: number }>("POST", `/program/days/${dayNumber}/exercises`, { name }),
  removeExercise: (id: number) => request<{ days: ProgramDay[] }>("DELETE", `/program/exercises/${id}`),

  history: () => request<{ sessions: HistoryItem[] }>("GET", "/history"),
  historyDetail: (id: string) => request<{ session: HistoryDetail }>("GET", `/history/${id}`),
  progress: () => request<ProgressData>("GET", "/progress"),
  day: (date?: string) => request<{ day: DayData }>("GET", `/day${date ? `?date=${date}` : ""}`),
  addFood: (date: string, food: Macros & { label: string }) =>
    request<{ day: DayData }>("POST", "/nutrition", { ...food, date }),
  copyFoods: (date: string, ids: string[]) =>
    request<{ day: DayData }>("POST", "/nutrition/copy", { date, ids }),
  updateFood: (id: string, food: Macros & { label: string }) =>
    request<{ day: DayData }>("PATCH", `/nutrition/${id}`, food),
  deleteFood: (id: string) => request<{ day: DayData }>("DELETE", `/nutrition/${id}`),
  logWeight: (date: string, weightKg: number) => request<{ day: DayData }>("POST", "/weight", { date, weightKg }),
  deleteWeight: (id: string, date: string) => request<{ day: DayData }>("DELETE", `/weight/${id}?date=${date}`),
  updateTargets: (
    date: string,
    targets: { calories: number; protein: number; fat?: number; carbs?: number },
  ) =>
    request<{ day: DayData }>("PATCH", "/targets", { ...targets, date }),
  addMeasurement: (date: string, values: Partial<Record<MeasurementField, number>>) =>
    request<{ day: DayData }>("POST", "/measurements", { ...values, date }),
  deleteMeasurement: (id: string, date: string) =>
    request<{ day: DayData }>("DELETE", `/measurements/${id}?date=${date}`),
  updateProfile: (date: string, profile: { heightCm: number | null; goal: Goal; weighInReminder: boolean }) =>
    request<{ day: DayData }>("PATCH", "/profile", { ...profile, date }),
  advice: (date: string) => request<{ advice: string | null }>("POST", "/health/advice", { date }),
  exerciseProgress: (id: number) =>
    request<{ name: string; progressionMode: string; points: OneRmPoint[] }>("GET", `/progress/exercises/${id}`),
};
