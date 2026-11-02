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
  records: Array<{ exerciseName: string; weight: number; reps: number }>;
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
  exercises: Array<{ exerciseId: number; name: string; sets: Array<{ weight: number; reps: number }> }>;
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
    request<{ firstName: string | null; days: DayView[]; workout: WorkoutView | null }>("GET", "/state"),
  start: (dayNumber: number) => request<{ workout: WorkoutView }>("POST", "/workout/start", { dayNumber }),
  logSet: (exerciseId: number, weight: number, reps: number) =>
    request<{ workout: WorkoutView; restSeconds: number }>("POST", "/workout/sets", { exerciseId, weight, reps }),
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
  exerciseProgress: (id: number) =>
    request<{ name: string; points: OneRmPoint[] }>("GET", `/progress/exercises/${id}`),
};
