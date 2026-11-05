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
  getHealthLog,
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
export function normalizeSleepMinutes(value: number | undefined): number | undefined {
  if (value == null) return undefined;
  if (value <= 20) return value * 60;
  if (value > 1200) return value / 60;
  return value;
}

/** «У ліжку» і неспання — не сон (назви залежать від мови iPhone). */
const NOT_SLEEP = /ліжк|bed|без сну|неспан|не сплю|прокин|пробудж|awake/i;

/** Тривалість одного запису з Shortcuts: секунди числом, «1:11:00», «1 год 11 хв» або «71 min». */
export function parseDurationSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "value" in value) {
    return parseDurationSeconds((value as { value: unknown }).value);
  }
  const text = String(value ?? "").trim().toLowerCase().replace(",", ".");
  if (!text) return undefined;

  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(text);
  if (clock) {
    const [, a, b, c] = clock;
    return c != null ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 3600 + Number(b) * 60;
  }

  let seconds = 0;
  let matched = false;
  for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*(год|г|h|хв|m|сек|с|s)/g)) {
    matched = true;
    const amount = Number(n);
    seconds += /^(год|г|h)$/.test(unit) ? amount * 3600 : /^(хв|m)$/.test(unit) ? amount * 60 : amount;
  }
  if (matched) return seconds;

  const plain = Number(text);
  return Number.isFinite(plain) ? plain : undefined;
}

/**
 * Сон за списком записів з шорткату (назва фази + тривалість, у тому самому порядку):
 * сумуємо фази, відкидаючи «У ліжку» і неспання. Тоді не треба вгадувати, як
 * неспання називається у фільтрах Shortcuts на конкретній мові.
 */
export function sleepFromStages(stages: unknown, durations: unknown): number | undefined {
  if (!Array.isArray(stages) || !Array.isArray(durations) || stages.length === 0) return undefined;
  if (stages.length !== durations.length) return undefined;

  let seconds = 0;
  for (let i = 0; i < stages.length; i++) {
    if (NOT_SLEEP.test(String(stages[i]))) continue;
    seconds += parseDurationSeconds(durations[i]) ?? 0;
  }
  return seconds > 0 ? normalizeSleepMinutes(seconds) : undefined;
}

/** Сон, що збігається з попередньою ніччю до хвилини, — майже напевно повтор старого запису. */
export function isStaleSleep(sleepMinutes: number | undefined, previousSleepMinutes: number | null | undefined): boolean {
  return sleepMinutes != null && previousSleepMinutes != null && Math.round(sleepMinutes) === previousSleepMinutes;
}

function shiftDay(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function parseSyncBody(body: Record<string, unknown>): {
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
    sleepMinutes:
      sleepFromStages(body.sleepStages, body.sleepDurations) ??
      normalizeSleepMinutes(numFromBody(body, ["sleepMinutes", "sleepMin", "sleep"], "sum")),
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

      // Якщо нова ніч ще не синхронізувалась, шорткат підхоплює вчорашню — точно той самий сон.
      const previous = await getHealthLog(user.id, shiftDay(parsed.date, -1));
      if (isStaleSleep(parsed.metrics.sleepMinutes, previous?.sleepMinutes)) {
        console.log(`Health sync: sleep ${parsed.metrics.sleepMinutes} min equals previous night — ignored as stale`);
        parsed.metrics.sleepMinutes = undefined;
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
