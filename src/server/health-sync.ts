import express from "express";
import { Bot } from "grammy";
import { BotContext } from "../bot/bot";
import { config, getPublicAppUrl } from "../config/env";
import { generateHealthAdvice } from "../services/health-coach.service";
import {
  HealthMetrics,
  buildHealthContext,
  findUserByHealthToken,
  formatHealthSummary,
  sanitizeHealthMetrics,
  upsertHealthLog,
} from "../services/health.service";
import { localDateString } from "../services/tracking.service";

let syncBot: Bot<BotContext> | null = null;

export function setHealthSyncBot(bot: Bot<BotContext>): void {
  syncBot = bot;
}

function parseSyncBody(body: Record<string, unknown>): {
  token: string;
  date: string;
  metrics: HealthMetrics;
} | null {
  const token = String(body.token ?? "").trim();
  if (!token) return null;

  const date =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : localDateString();

  const num = (...keys: string[]) => {
    for (const key of keys) {
      const v = body[key];
      if (v == null || v === "") continue;
      const n = Number(String(v).replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  const metrics = sanitizeHealthMetrics({
    sleepMinutes: num("sleepMinutes", "sleepMin"),
    restingHr: num("restingHr", "restingHR", "RestingHR", "resting_hr"),
    hrv: num("hrv", "HRV"),
    steps: num("steps", "Steps"),
    activeCalories: num("activeCalories", "activeCal", "ActiveCal", "active_calories"),
    standHours: num("standHours", "stand_hours"),
    workoutMinutes: num("workoutMinutes", "workout_minutes"),
  });

  const hasData = Object.values(metrics).some((v) => v != null && v > 0);
  if (!hasData) return null;

  return { token, date, metrics };
}

export function registerHealthSyncRoutes(app: express.Application): void {
  app.post("/api/health/sync", express.json({ limit: "32kb" }), async (req, res) => {
    try {
      const parsed = parseSyncBody(req.body as Record<string, unknown>);
      if (!parsed) {
        res.status(400).json({ ok: false, error: "Invalid payload" });
        return;
      }

      const user = await findUserByHealthToken(parsed.token);
      if (!user) {
        res.status(401).json({ ok: false, error: "Invalid token" });
        return;
      }

      const log = await upsertHealthLog(user.id, parsed.date, parsed.metrics, "apple_watch");
      res.json({ ok: true, date: log.date });

      if (!syncBot || !user.reminder) return;

      const chatId = Number(user.reminder.chatId);
      const summary = formatHealthSummary(log);
      await syncBot.api.sendMessage(chatId, `⌚ <b>Дані з Apple Watch синхронізовано</b>\n\n${summary}`, {
        parse_mode: "HTML",
      });

      const ctx = await buildHealthContext(user.id, parsed.date);
      if (ctx) {
        const advice = await generateHealthAdvice(ctx);
        await syncBot.api.sendMessage(chatId, `🧠 <b>Поради на сьогодні</b>\n\n${advice}`, {
          parse_mode: "HTML",
        });
      }
    } catch (error) {
      console.error("Health sync error:", error);
      res.status(500).json({ ok: false, error: "Server error" });
    }
  });
}
