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

function parseNumericValue(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "value" in value) {
    return parseNumericValue((value as { value: unknown }).value);
  }
  const cleaned = String(value).replace(",", ".").replace(/[^\d.-]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function numFromBody(
  body: Record<string, unknown>,
  keys: string[],
  mode: "first" | "sum" = "first",
): number | undefined {
  for (const key of keys) {
    const value = body[key];
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      const nums = value.map(parseNumericValue).filter((n): n is number => n != null && n > 0);
      if (nums.length === 0) continue;
      return mode === "sum" ? nums.reduce((sum, n) => sum + n, 0) : nums[0];
    }
    const n = parseNumericValue(value);
    // Shortcuts often sends 0 for an empty Number JSON field — try the next alias key.
    if (n != null && n > 0) return n;
  }
  return undefined;
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

  const metrics = sanitizeHealthMetrics({
    sleepMinutes: numFromBody(body, ["sleepMinutes", "sleepMin"]),
    restingHr: numFromBody(body, ["restingHr", "restingHR", "RestingHR", "resting_hr"]),
    hrv: numFromBody(body, ["hrv", "HRV"]),
    steps: numFromBody(body, ["steps", "Steps"]),
    activeCalories: numFromBody(
      body,
      ["activeCalories", "activeCal", "ActiveCal", "active_calories"],
      "sum",
    ),
    standHours: numFromBody(body, ["standHours", "stand_hours"]),
    workoutMinutes: numFromBody(body, ["workoutMinutes", "workout_minutes"]),
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

      const body = req.body as Record<string, unknown>;
      const rawActive = body.activeCalories ?? body.activeCal ?? body.ActiveCal;
      if (rawActive != null && rawActive !== "" && parsed.metrics.activeCalories == null) {
        console.warn("Health sync: activeCalories rejected", {
          raw: rawActive,
          keys: Object.keys(body).filter((k) => k !== "token"),
        });
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
