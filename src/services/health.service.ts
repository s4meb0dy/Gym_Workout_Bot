import { randomBytes } from "crypto";
import { prisma } from "../db/client";
import {
  getLatestBodyWeight,
  getProteinForDate,
  getProteinTarget,
  getWaterForDate,
  getWaterTarget,
  localDateString,
} from "./tracking.service";

export interface HealthMetrics {
  sleepMinutes?: number;
  restingHr?: number;
  hrv?: number;
  steps?: number;
  activeCalories?: number;
  standHours?: number;
  workoutMinutes?: number;
}

function sanitizeMetric(value: number | undefined, min: number, max: number): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return undefined;
  return rounded;
}

function sanitizeFloat(value: number | undefined, min: number, max: number, decimals = 1): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const factor = 10 ** decimals;
  const fixed = Math.round(value * factor) / factor;
  if (fixed < min || fixed > max) return undefined;
  return fixed;
}

/** Shortcuts may send 45.7 as 457... when the decimal separator is dropped in JSON. */
export function fixMangledDecimal(n: number, min: number, max: number): number | undefined {
  if (n >= min && n <= max) return Math.round(n * 10) / 10;
  for (let k = 1; k <= 15; k++) {
    const v = n / 10 ** k;
    if (v >= min && v <= max) return Math.round(v * 10) / 10;
  }
  return undefined;
}

function sanitizeActiveCalories(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const recovered = fixMangledDecimal(value, 10, 3500);
  if (recovered != null) return Math.round(recovered);
  return sanitizeMetric(value, 10, 3500);
}

/** Drops Shortcut/Health outliers (e.g. duration mistaken for kcal). */
export function sanitizeHealthMetrics(metrics: HealthMetrics): HealthMetrics {
  const hrvRaw = metrics.hrv != null ? fixMangledDecimal(metrics.hrv, 15, 120) : undefined;
  return {
    sleepMinutes: sanitizeMetric(metrics.sleepMinutes, 1, 1200),
    restingHr: sanitizeMetric(metrics.restingHr, 30, 220),
    hrv: sanitizeFloat(hrvRaw, 15, 120),
    steps: sanitizeMetric(metrics.steps, 1, 150_000),
    activeCalories: sanitizeActiveCalories(metrics.activeCalories),
    standHours: sanitizeMetric(metrics.standHours, 1, 24),
    workoutMinutes: sanitizeMetric(metrics.workoutMinutes, 1, 1440),
  };
}

export interface HealthContext {
  date: string;
  metrics: HealthMetrics;
  latestWeightKg?: number;
  proteinYesterday?: number;
  proteinTarget: number;
  waterYesterdayMl?: number;
  waterTargetMl: number;
  lastWorkout?: { dayName: string; date: string; sets: number };
  workoutsThisWeek: number;
}

function parseSleepToMinutes(token: string): number | null {
  const hColonM = /^(\d{1,2}):(\d{1,2})$/.exec(token);
  if (hColonM) {
    return Number(hColonM[1]) * 60 + Number(hColonM[2]);
  }
  const hours = Number(token.replace(",", "."));
  if (Number.isFinite(hours) && hours > 0 && hours <= 16) {
    return Math.round(hours * 60);
  }
  return null;
}

export function parseHealthInput(text: string): { date: string; metrics: HealthMetrics } | null {
  let rest = text.trim();
  let date = localDateString();

  const dateMatch = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(rest);
  if (dateMatch) {
    date = dateMatch[1];
    rest = dateMatch[2];
  }

  const sleepMatch =
    /(?:сон|sleep)\s*[:=]?\s*(\d{1,2}(?:[:.,]\d{1,2})?|\d{1,2}:\d{2})/i.exec(rest) ??
    /^(\d{1,2}(?:[:.,]\d{1,2})?|\d{1,2}:\d{2})\s/.exec(rest);

  if (sleepMatch) {
    const sleepMinutes = parseSleepToMinutes(sleepMatch[1].replace(",", "."));
    if (sleepMinutes) {
      rest = rest.replace(sleepMatch[0], " ").trim();
    }
  }

  const labeled: HealthMetrics = {};

  const patterns: Array<[keyof HealthMetrics, RegExp]> = [
    ["restingHr", /(?:пульс|hr|bpm)\s*[:=]?\s*(\d{2,3})/i],
    ["hrv", /(?:hrv|варіабельність)\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)/i],
    ["steps", /(?:крок|steps)\s*[:=]?\s*(\d{3,6})/i],
    ["activeCalories", /(?:актив|active|ккал)\s*[:=]?\s*(\d{2,4})/i],
    ["standHours", /(?:stand|стояти)\s*[:=]?\s*(\d{1,2})/i],
    ["workoutMinutes", /(?:трен|workout)\s*[:=]?\s*(\d{1,3})/i],
  ];

  for (const [field, pattern] of patterns) {
    const m = pattern.exec(rest);
    if (m) {
      labeled[field] = Number(m[1].replace(",", ".")) as never;
      rest = rest.replace(m[0], " ").trim();
    }
  }

  if (sleepMatch) {
    const sleepMinutes = parseSleepToMinutes(sleepMatch[1].replace(",", "."));
    if (sleepMinutes) labeled.sleepMinutes = sleepMinutes;
  }

  const nums = rest
    .split(/\s+/)
    .map((x) => Number(x.replace(",", ".")))
    .filter((n) => Number.isFinite(n));

  const metrics: HealthMetrics = { ...labeled };
  const order: Array<keyof HealthMetrics> = [
    "sleepMinutes",
    "restingHr",
    "hrv",
    "steps",
    "activeCalories",
    "standHours",
    "workoutMinutes",
  ];

  let i = 0;
  if (!metrics.sleepMinutes && nums[i] != null) {
    const asSleep = nums[i];
    if (asSleep <= 16) {
      metrics.sleepMinutes = Math.round(asSleep * 60);
    } else {
      metrics.sleepMinutes = Math.round(asSleep);
    }
    i++;
  }

  for (const key of order.slice(1)) {
    if (metrics[key] == null && nums[i] != null) {
      metrics[key] = nums[i] as never;
      i++;
    }
  }

  const hasData = Object.values(metrics).some((v) => v != null && v > 0);
  return hasData ? { date, metrics } : null;
}

export async function ensureHealthSyncToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.healthSyncToken) {
    return user.healthSyncToken;
  }
  const token = randomBytes(24).toString("hex");
  await prisma.user.update({ where: { id: userId }, data: { healthSyncToken: token } });
  return token;
}

export async function findUserByHealthToken(token: string) {
  return prisma.user.findUnique({
    where: { healthSyncToken: token },
    include: { reminder: true },
  });
}

export async function upsertHealthLog(
  userId: string,
  date: string,
  metrics: HealthMetrics,
  source = "apple_watch",
) {
  const m = sanitizeHealthMetrics(metrics);
  const recordedAt = new Date();

  const createData = {
    userId,
    date,
    sleepMinutes: m.sleepMinutes ?? null,
    restingHr: m.restingHr ?? null,
    hrv: m.hrv ?? null,
    steps: m.steps ?? null,
    activeCalories: m.activeCalories ?? null,
    standHours: m.standHours ?? null,
    workoutMinutes: m.workoutMinutes ?? null,
    source,
    recordedAt,
  };

  const updateData: Record<string, unknown> = { source, recordedAt };
  if (m.sleepMinutes != null) updateData.sleepMinutes = m.sleepMinutes;
  if (m.restingHr != null) updateData.restingHr = m.restingHr;
  if (m.hrv != null) updateData.hrv = m.hrv;
  if (m.steps != null) updateData.steps = m.steps;
  if (m.activeCalories != null) updateData.activeCalories = m.activeCalories;
  if (m.standHours != null) updateData.standHours = m.standHours;
  if (m.workoutMinutes != null) updateData.workoutMinutes = m.workoutMinutes;

  return prisma.healthLog.upsert({
    where: { userId_date: { userId, date } },
    update: updateData,
    create: createData,
  });
}

export async function getHealthLog(userId: string, date = localDateString()) {
  return prisma.healthLog.findUnique({ where: { userId_date: { userId, date } } });
}

export async function getHealthHistory(userId: string, days = 7) {
  return prisma.healthLog.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: days,
  });
}

export function formatSleep(minutes?: number | null): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}

export function formatHealthSummary(log: {
  date: string;
  sleepMinutes?: number | null;
  restingHr?: number | null;
  hrv?: number | null;
  steps?: number | null;
  activeCalories?: number | null;
  standHours?: number | null;
  workoutMinutes?: number | null;
}): string {
  const lines = [
    `📅 ${log.date === localDateString() ? "Сьогодні" : log.date}`,
    `😴 Сон: ${formatSleep(log.sleepMinutes)}`,
    `❤️ Пульс спокою: ${log.restingHr ?? "—"} уд/хв`,
    `📈 HRV: ${log.hrv != null ? Math.round(log.hrv) : "—"} мс`,
    `👟 Кроки: ${log.steps?.toLocaleString("uk-UA") ?? "—"}`,
    `🔥 Активні ккал: ${log.activeCalories ?? "—"}`,
  ];
  if (log.standHours) lines.push(`🧍 Stand: ${log.standHours} год`);
  if (log.workoutMinutes) lines.push(`🏋️ Тренування: ${log.workoutMinutes} хв`);
  return lines.join("\n");
}

export async function buildHealthContext(userId: string, date: string): Promise<HealthContext | null> {
  const log = await getHealthLog(userId, date);
  if (!log) return null;

  const yesterday = shiftDateString(date, -1);
  const weekAgo = shiftDateString(date, -7);

  const [weight, proteinYesterday, proteinTarget, waterYesterday, waterTarget, lastSession, weekCount] =
    await Promise.all([
      getLatestBodyWeight(userId),
      getProteinForDate(userId, yesterday),
      getProteinTarget(userId),
      getWaterForDate(userId, yesterday),
      getWaterTarget(userId),
      prisma.workoutSession.findFirst({
        where: { userId, completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        include: { workoutDay: true, sets: true },
      }),
      prisma.workoutSession.count({
        where: {
          userId,
          completedAt: { not: null, gte: new Date(`${weekAgo}T00:00:00Z`) },
        },
      }),
    ]);

  const workingSets = lastSession?.sets.filter((s) => s.weight > 0 && s.reps > 0).length ?? 0;

  return {
    date,
    metrics: {
      sleepMinutes: log.sleepMinutes ?? undefined,
      restingHr: log.restingHr ?? undefined,
      hrv: log.hrv ?? undefined,
      steps: log.steps ?? undefined,
      activeCalories: log.activeCalories ?? undefined,
      standHours: log.standHours ?? undefined,
      workoutMinutes: log.workoutMinutes ?? undefined,
    },
    latestWeightKg: weight?.weightKg,
    proteinYesterday: Math.round(proteinYesterday),
    proteinTarget,
    waterYesterdayMl: waterYesterday,
    waterTargetMl: waterTarget,
    lastWorkout: lastSession
      ? {
          dayName: lastSession.workoutDay.name,
          date: lastSession.completedAt!.toISOString().slice(0, 10),
          sets: workingSets,
        }
      : undefined,
    workoutsThisWeek: weekCount,
  };
}

function shiftDateString(date: string, deltaDays: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return localDateString(d);
}
