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

/**
 * Shortcuts віддає тривалість сну в різних одиницях залежно від дії: години (7.5),
 * хвилини (450) або секунди (27000). Ніч не буває довшою за 20 год, тож одиниця
 * однозначно визначається за величиною.
 */
function normalizeSleepMinutes(value: number | undefined): number | undefined {
  if (value == null) return undefined;
  if (value <= 20) return value * 60;
  if (value > 1200) return value / 60;
  return value;
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
    sleepMinutes: normalizeSleepMinutes(numFromBody(body, ["sleepMinutes", "sleepMin", "sleep"], "sum")),
    restingHr: numFromBody(body, ["restingHr", "restingHR", "RestingHR", "resting_hr"]),
    hrv: numFromBody(body, ["hrv", "HRV"]),
    steps: numFromBody(body, ["steps", "Steps"], "sum"),
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
      const parsed = parseSyncBody((req.body ?? {}) as Record<string, unknown>);
      if (!parsed) {
        // Для діагностики шорткатів: що саме прийшло (без токена).
        const { token: _token, ...rest } = (req.body ?? {}) as Record<string, unknown>;
        console.warn("Health sync: invalid payload", JSON.stringify(rest).slice(0, 1000));
        res.status(400).json({ ok: false, error: "Invalid payload" });
        return;
      }

      // Що надіслав шорткат і що з цього прийнято — без токена, для діагностики.
      const { token: _token, ...raw } = (req.body ?? {}) as Record<string, unknown>;
      console.log("Health sync:", JSON.stringify(raw).slice(0, 500), "→", JSON.stringify(parsed.metrics));

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
