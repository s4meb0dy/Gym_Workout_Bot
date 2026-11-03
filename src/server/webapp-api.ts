import path from "path";
import { existsSync } from "fs";
import express from "express";
import { Api } from "grammy";
import { User } from "@prisma/client";
import { clearRest, scheduleRest } from "../bot/rest-timer";
import { prisma } from "../db/client";
import {
  getExercisesWithHistory,
  getOneRmHistory,
  getWeeklyVolume,
} from "../services/analytics.service";
import {
  buildDaysView,
  buildHistoryDetail,
  buildHistoryList,
  buildProgramView,
  buildWeeklyStats,
  buildWorkoutView,
  findOwnActiveSet,
  nextSetNumber,
} from "../services/webapp.service";
import {
  addExerciseToDay,
  cancelActiveSession,
  completeWorkoutSession,
  deleteExercise,
  exerciseHasHistory,
  getActiveSession,
  getExerciseById,
  getWorkoutDayByNumber,
  logSet,
  moveExercise,
  renameExercise,
  startWorkoutSession,
  updateExerciseTargets,
  updateSet,
} from "../services/workout.service";
import { buildAdvice, buildDayView, isValidDay } from "../services/webapp-day.service";
import { parseGoal } from "../services/energy.service";
import {
  addNutritionEntry,
  addWater,
  copyNutritionEntries,
  deleteBodyWeight,
  deleteNutritionEntry,
  getBodyWeightById,
  getNutritionEntryById,
  localDateString,
  logBodyWeight,
  MacroEntry,
  undoLastWater,
  updateNutritionEntry,
  upsertReminderSetting,
} from "../services/tracking.service";
import { detectSetRecord } from "../services/records.service";
import { requireWebAppUser } from "./webapp-auth";

let botApi: Api | null = null;

export function setWebAppBotApi(api: Api): void {
  botApi = api;
}

const WEBAPP_DIST = path.resolve(__dirname, "../../webapp/dist");

type Handler = (req: express.Request, res: express.Response, user: User) => Promise<void>;

function route(handler: Handler): express.RequestHandler {
  return (req, res, next) => {
    handler(req, res, res.locals.user as User).catch(next);
  };
}

function parseSetBody(body: unknown): { weight: number; reps: number } | null {
  const { weight, reps } = (body ?? {}) as Record<string, unknown>;
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isInteger(r) || w < 0 || w > 1000 || r < 1 || r > 600) {
    return null;
  }
  return { weight: Math.round(w * 100) / 100, reps: r };
}

type ExerciseUpdate = {
  name?: string;
  targetSets?: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
  restTimeInSeconds?: number;
  progressionStep?: number;
  technique?: string | null;
};

function parseExerciseUpdate(body: unknown): ExerciseUpdate | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: ExerciseUpdate = {};

  const int = (key: string, min: number, max: number): number | undefined | null => {
    if (b[key] === undefined) return undefined;
    const n = Number(b[key]);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };

  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (name.length < 2 || name.length > 100) return null;
    out.name = name;
  }

  const fields: Array<[keyof ExerciseUpdate, string, number, number]> = [
    ["targetSets", "targetSets", 1, 10],
    ["targetRepsMin", "targetRepsMin", 1, 600],
    ["targetRepsMax", "targetRepsMax", 1, 600],
    ["restTimeInSeconds", "restSeconds", 0, 600],
  ];
  for (const [field, key, min, max] of fields) {
    const v = int(key, min, max);
    if (v === null) return null;
    if (v !== undefined) (out as Record<string, unknown>)[field] = v;
  }

  if (b.progressionStep !== undefined) {
    const step = Number(b.progressionStep);
    if (!Number.isFinite(step) || step <= 0 || step > 50) return null;
    out.progressionStep = Math.round(step * 100) / 100;
  }

  if (b.technique !== undefined) {
    const technique = String(b.technique ?? "").trim();
    if (technique.length > 1000) return null;
    out.technique = technique || null;
  }

  return out;
}

function parseMacros(body: unknown): MacroEntry | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const nums = [b.calories, b.protein, b.fat, b.carbs].map((v) => Number(v ?? 0));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 10000)) return null;
  const [calories, protein, fat, carbs] = nums;
  if (calories === 0 && protein === 0) return null;
  const label = String(b.label ?? "").trim().slice(0, 80);
  return { calories, protein, fat, carbs, label: label || (calories > 0 ? "Їжа (вручну)" : "Білок") };
}

function notifyRest(user: User, seconds: number): void {
  if (botApi) {
    scheduleRest(botApi, Number(user.telegramId), seconds);
  }
}

export function registerWebAppRoutes(app: express.Application): void {
  const api = express.Router();
  api.use(express.json({ limit: "16kb" }));
  api.use(requireWebAppUser);

  api.get(
    "/state",
    route(async (_req, res, user) => {
      const [days, workout] = await Promise.all([buildDaysView(user.id), buildWorkoutView(user.id)]);
      res.json({ firstName: user.firstName, days, workout });
    }),
  );

  api.post(
    "/workout/start",
    route(async (req, res, user) => {
      const day = await getWorkoutDayByNumber(Number(req.body?.dayNumber));
      if (!day) {
        res.status(404).json({ error: "day_not_found" });
        return;
      }
      if (!(await getActiveSession(user.id))) {
        await startWorkoutSession(user.id, day.id);
      }
      res.json({ workout: await buildWorkoutView(user.id) });
    }),
  );

  api.post(
    "/workout/sets",
    route(async (req, res, user) => {
      const session = await getActiveSession(user.id);
      const exercise = session?.workoutDay.exercises.find((e) => e.id === Number(req.body?.exerciseId));
      const parsed = parseSetBody(req.body);
      if (!session || !exercise || !parsed) {
        res.status(400).json({ error: "invalid_set" });
        return;
      }

      const setNumber = await nextSetNumber(session.id, exercise.id);
      const created = await logSet(session.id, exercise.id, setNumber, parsed.weight, parsed.reps);
      notifyRest(user, exercise.restTimeInSeconds);
      const record = await detectSetRecord(user.id, created.id);
      res.json({
        workout: await buildWorkoutView(user.id),
        restSeconds: exercise.restTimeInSeconds,
        record: record?.text ?? null,
      });
    }),
  );

  api.patch(
    "/workout/sets/:id",
    route(async (req, res, user) => {
      const set = await findOwnActiveSet(user.id, String(req.params.id));
      const parsed = parseSetBody(req.body);
      if (!set || !parsed) {
        res.status(400).json({ error: "invalid_set" });
        return;
      }
      await updateSet(set.id, parsed.weight, parsed.reps, set.rpe, set.note);
      res.json({ workout: await buildWorkoutView(user.id) });
    }),
  );

  api.delete(
    "/workout/sets/:id",
    route(async (req, res, user) => {
      const set = await findOwnActiveSet(user.id, String(req.params.id));
      if (!set) {
        res.status(404).json({ error: "set_not_found" });
        return;
      }
      await prisma.set.delete({ where: { id: set.id } });
      res.json({ workout: await buildWorkoutView(user.id) });
    }),
  );

  api.post(
    "/workout/rest/cancel",
    route(async (_req, res, user) => {
      clearRest(Number(user.telegramId));
      res.json({ ok: true });
    }),
  );

  api.post(
    "/workout/finish",
    route(async (_req, res, user) => {
      const session = await getActiveSession(user.id);
      if (!session) {
        res.status(404).json({ error: "no_active_session" });
        return;
      }
      clearRest(Number(user.telegramId));
      const summary = await completeWorkoutSession(session.id);
      const durationMinutes = Math.round((summary.completedAt.getTime() - session.startedAt.getTime()) / 60000);
      res.json({ summary: { ...summary, durationMinutes, dayName: session.workoutDay.name } });
    }),
  );

  api.post(
    "/workout/cancel",
    route(async (_req, res, user) => {
      clearRest(Number(user.telegramId));
      await cancelActiveSession(user.id);
      res.json({ ok: true });
    }),
  );

  // ---- Program ----

  api.get(
    "/program",
    route(async (_req, res, user) => {
      res.json({ days: await buildProgramView(user.id) });
    }),
  );

  api.patch(
    "/program/exercises/:id",
    route(async (req, res, user) => {
      const exercise = await getExerciseById(Number(req.params.id));
      const update = parseExerciseUpdate(req.body);
      if (!exercise || !update) {
        res.status(400).json({ error: "invalid_exercise" });
        return;
      }
      if (update.name && update.name !== exercise.name) {
        await renameExercise(exercise.id, update.name);
      }
      const { name: _name, ...targets } = update;
      const min = targets.targetRepsMin ?? exercise.targetRepsMin;
      const max = targets.targetRepsMax ?? exercise.targetRepsMax;
      if (min > max) {
        targets.targetRepsMax = min;
      }
      await updateExerciseTargets(exercise.id, targets);
      res.json({ days: await buildProgramView(user.id) });
    }),
  );

  api.post(
    "/program/exercises/:id/move",
    route(async (req, res, user) => {
      const direction = req.body?.direction === "up" ? "up" : "down";
      await moveExercise(Number(req.params.id), direction);
      res.json({ days: await buildProgramView(user.id) });
    }),
  );

  api.post(
    "/program/days/:dayNumber/exercises",
    route(async (req, res, user) => {
      const day = await getWorkoutDayByNumber(Number(req.params.dayNumber));
      const name = String(req.body?.name ?? "").trim();
      if (!day || name.length < 2 || name.length > 100) {
        res.status(400).json({ error: "invalid_exercise" });
        return;
      }
      const created = await addExerciseToDay(day.id, name);
      res.json({ days: await buildProgramView(user.id), createdId: created.id });
    }),
  );

  api.delete(
    "/program/exercises/:id",
    route(async (req, res, user) => {
      const exercise = await getExerciseById(Number(req.params.id));
      if (!exercise) {
        res.status(404).json({ error: "exercise_not_found" });
        return;
      }
      // Вправу з історією не видаляємо, а архівуємо (targetSets = 0), щоб графіки лишились.
      if (await exerciseHasHistory(exercise.id)) {
        await updateExerciseTargets(exercise.id, { targetSets: 0 });
      } else {
        await deleteExercise(exercise.id);
      }
      res.json({ days: await buildProgramView(user.id) });
    }),
  );

  // ---- History & progress ----

  api.get(
    "/history",
    route(async (_req, res, user) => {
      res.json({ sessions: await buildHistoryList(user.id) });
    }),
  );

  api.get(
    "/history/:id",
    route(async (req, res, user) => {
      const detail = await buildHistoryDetail(user.id, String(req.params.id));
      if (!detail) {
        res.status(404).json({ error: "session_not_found" });
        return;
      }
      res.json({ session: detail });
    }),
  );

  api.get(
    "/progress",
    route(async (_req, res, user) => {
      const [weeks, volume, exercises] = await Promise.all([
        buildWeeklyStats(user.id),
        getWeeklyVolume(user.id, 7),
        getExercisesWithHistory(user.id),
      ]);
      res.json({ weeks, volume, exercises });
    }),
  );

  api.get(
    "/progress/exercises/:id",
    route(async (req, res, user) => {
      const exercise = await getExerciseById(Number(req.params.id));
      if (!exercise) {
        res.status(404).json({ error: "exercise_not_found" });
        return;
      }
      const points = await getOneRmHistory(user.id, exercise.id);
      res.json({ name: exercise.name, progressionMode: exercise.progressionMode, points });
    }),
  );

  // ---- Day: nutrition, water, body weight, health ----

  const dayOf = (value: unknown) => (isValidDay(value) ? value : localDateString());
  const sendDay = async (res: express.Response, user: User, date: string) => {
    res.json({ day: await buildDayView(user.id, date) });
  };

  api.get(
    "/day",
    route(async (req, res, user) => {
      await sendDay(res, user, dayOf(req.query.date));
    }),
  );

  api.post(
    "/nutrition",
    route(async (req, res, user) => {
      const entry = parseMacros(req.body);
      if (!entry) {
        res.status(400).json({ error: "invalid_entry" });
        return;
      }
      const date = dayOf(req.body?.date);
      await addNutritionEntry(user.id, entry, date);
      await sendDay(res, user, date);
    }),
  );

  api.post(
    "/nutrition/copy",
    route(async (req, res, user) => {
      const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(String).slice(0, 50) : [];
      if (ids.length === 0) {
        res.status(400).json({ error: "invalid_copy" });
        return;
      }
      const date = dayOf(req.body?.date);
      await copyNutritionEntries(user.id, ids, date);
      await sendDay(res, user, date);
    }),
  );

  api.patch(
    "/nutrition/:id",
    route(async (req, res, user) => {
      const existing = await getNutritionEntryById(String(req.params.id));
      const entry = parseMacros(req.body);
      if (!existing || existing.userId !== user.id || !entry) {
        res.status(400).json({ error: "invalid_entry" });
        return;
      }
      await updateNutritionEntry(existing.id, entry);
      await sendDay(res, user, existing.date);
    }),
  );

  api.delete(
    "/nutrition/:id",
    route(async (req, res, user) => {
      const existing = await getNutritionEntryById(String(req.params.id));
      if (!existing || existing.userId !== user.id) {
        res.status(404).json({ error: "entry_not_found" });
        return;
      }
      await deleteNutritionEntry(existing.id);
      await sendDay(res, user, existing.date);
    }),
  );

  api.post(
    "/water",
    route(async (req, res, user) => {
      const ml = Number(req.body?.ml);
      if (!Number.isFinite(ml) || ml < 10 || ml > 3000) {
        res.status(400).json({ error: "invalid_water" });
        return;
      }
      const date = dayOf(req.body?.date);
      await addWater(user.id, ml, date);
      await sendDay(res, user, date);
    }),
  );

  api.post(
    "/water/undo",
    route(async (req, res, user) => {
      const date = dayOf(req.body?.date);
      await undoLastWater(user.id, date);
      await sendDay(res, user, date);
    }),
  );

  api.post(
    "/weight",
    route(async (req, res, user) => {
      const kg = Number(req.body?.weightKg);
      if (!Number.isFinite(kg) || kg < 30 || kg > 300) {
        res.status(400).json({ error: "invalid_weight" });
        return;
      }
      await logBodyWeight(user.id, Math.round(kg * 10) / 10);
      await sendDay(res, user, dayOf(req.body?.date));
    }),
  );

  api.delete(
    "/weight/:id",
    route(async (req, res, user) => {
      const row = await getBodyWeightById(String(req.params.id));
      if (!row || row.userId !== user.id) {
        res.status(404).json({ error: "weight_not_found" });
        return;
      }
      await deleteBodyWeight(row.id);
      await sendDay(res, user, dayOf(req.query.date));
    }),
  );

  api.patch(
    "/targets",
    route(async (req, res, user) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const calories = Number(b.calories);
      const protein = Number(b.protein);
      const waterMl = Number(b.waterMl);
      const fat = b.fat === undefined ? undefined : Number(b.fat);
      const carbs = b.carbs === undefined ? undefined : Number(b.carbs);
      if (
        (fat !== undefined && (!Number.isInteger(fat) || fat < 10 || fat > 400)) ||
        (carbs !== undefined && (!Number.isInteger(carbs) || carbs < 0 || carbs > 1200))
      ) {
        res.status(400).json({ error: "invalid_targets" });
        return;
      }
      if (
        !Number.isInteger(calories) || calories < 800 || calories > 6000 ||
        !Number.isInteger(protein) || protein < 20 || protein > 400 ||
        !Number.isInteger(waterMl) || waterMl < 500 || waterMl > 8000
      ) {
        res.status(400).json({ error: "invalid_targets" });
        return;
      }
      await upsertReminderSetting(user.id, Number(user.telegramId), {
        calorieTarget: calories,
        proteinTarget: protein,
        waterTargetMl: waterMl,
        ...(fat !== undefined ? { fatTarget: fat } : {}),
        ...(carbs !== undefined ? { carbsTarget: carbs } : {}),
      });
      await sendDay(res, user, dayOf(b.date));
    }),
  );

  api.patch(
    "/profile",
    route(async (req, res, user) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const heightCm = b.heightCm == null || b.heightCm === "" ? null : Number(b.heightCm);
      if (heightCm != null && (!Number.isInteger(heightCm) || heightCm < 120 || heightCm > 230)) {
        res.status(400).json({ error: "invalid_profile" });
        return;
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { heightCm, goal: parseGoal(b.goal) },
      });
      if (typeof b.weighInReminder === "boolean") {
        await upsertReminderSetting(user.id, Number(user.telegramId), { weightEnabled: b.weighInReminder });
      }
      await sendDay(res, user, dayOf(b.date));
    }),
  );

  api.post(
    "/health/advice",
    route(async (req, res, user) => {
      const advice = await buildAdvice(user.id, dayOf(req.body?.date));
      res.json({ advice });
    }),
  );

  api.use(((error, _req, res, _next) => {
    console.error("WebApp API error:", error);
    res.status(500).json({ error: "server_error" });
  }) as express.ErrorRequestHandler);

  app.use("/api/app", api);

  if (existsSync(WEBAPP_DIST)) {
    app.use("/app", express.static(WEBAPP_DIST, { index: "index.html" }));
  } else {
    console.warn(`Mini App build not found at ${WEBAPP_DIST} — run "npm run build".`);
  }
}
