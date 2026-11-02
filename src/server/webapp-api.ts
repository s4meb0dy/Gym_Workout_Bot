import path from "path";
import { existsSync } from "fs";
import express from "express";
import { Api } from "grammy";
import { User } from "@prisma/client";
import { clearRest, scheduleRest } from "../bot/rest-timer";
import { prisma } from "../db/client";
import {
  buildDaysView,
  buildWorkoutView,
  findOwnActiveSet,
  nextSetNumber,
} from "../services/webapp.service";
import {
  cancelActiveSession,
  completeWorkoutSession,
  getActiveSession,
  getWorkoutDayByNumber,
  logSet,
  startWorkoutSession,
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
