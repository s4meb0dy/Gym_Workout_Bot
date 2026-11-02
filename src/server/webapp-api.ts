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
      await logSet(session.id, exercise.id, setNumber, parsed.weight, parsed.reps);
      notifyRest(user, exercise.restTimeInSeconds);
      res.json({ workout: await buildWorkoutView(user.id), restSeconds: exercise.restTimeInSeconds });
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
      const durationMinutes = Math.round((Date.now() - session.startedAt.getTime()) / 60000);
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
      res.json({ name: exercise.name, points });
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
