import { prisma } from "../db/client";
import { config } from "../config/env";

export function localDateString(date: Date = new Date(), timeZone = config.timezone): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDisplayDate(date: Date, timeZone = config.timezone): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

// ---- Body weight ----

export async function logBodyWeight(userId: string, weightKg: number) {
  return prisma.bodyWeight.create({
    data: { userId, weightKg },
  });
}

export async function getBodyWeights(userId: string, limit = 60) {
  const rows = await prisma.bodyWeight.findMany({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
  return rows.reverse();
}

export async function getLatestBodyWeight(userId: string) {
  return prisma.bodyWeight.findFirst({
    where: { userId },
    orderBy: { recordedAt: "desc" },
  });
}

/** Просте ковзне середнє для згладжування добових коливань. */
export function movingAverage(values: number[], window = 7): number[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const sum = slice.reduce((acc, v) => acc + v, 0);
    return sum / slice.length;
  });
}

// ---- Nutrition (protein) ----

export async function addProtein(userId: string, proteinGrams: number, date = localDateString()) {
  return prisma.nutritionLog.create({
    data: { userId, proteinGrams, date },
  });
}

export interface MacroEntry {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  label?: string;
}

export async function addNutritionEntry(
  userId: string,
  entry: MacroEntry,
  date = localDateString(),
) {
  return prisma.nutritionLog.create({
    data: {
      userId,
      date,
      proteinGrams: entry.protein,
      calories: entry.calories,
      fatGrams: entry.fat,
      carbsGrams: entry.carbs,
      label: entry.label ?? null,
    },
  });
}

export interface DailyMacros {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export async function getMacrosForDate(
  userId: string,
  date = localDateString(),
): Promise<DailyMacros> {
  const result = await prisma.nutritionLog.aggregate({
    where: { userId, date },
    _sum: { calories: true, proteinGrams: true, fatGrams: true, carbsGrams: true },
  });
  return {
    calories: Math.round(result._sum.calories ?? 0),
    protein: Math.round(result._sum.proteinGrams ?? 0),
    fat: Math.round(result._sum.fatGrams ?? 0),
    carbs: Math.round(result._sum.carbsGrams ?? 0),
  };
}

export async function getCalorieTarget(userId: string): Promise<number> {
  const setting = await prisma.reminderSetting.findUnique({ where: { userId } });
  return setting?.calorieTarget ?? 2000;
}

export async function getProteinForDate(userId: string, date = localDateString()): Promise<number> {
  const result = await prisma.nutritionLog.aggregate({
    where: { userId, date },
    _sum: { proteinGrams: true },
  });
  return result._sum.proteinGrams ?? 0;
}

export async function resetProteinForDate(userId: string, date = localDateString()) {
  return prisma.nutritionLog.deleteMany({ where: { userId, date } });
}

export async function getProteinHistory(userId: string, days = 14) {
  const logs = await prisma.nutritionLog.groupBy({
    by: ["date"],
    where: { userId },
    _sum: { proteinGrams: true },
    orderBy: { date: "desc" },
    take: days,
  });
  return logs
    .map((l) => ({ date: l.date, total: l._sum.proteinGrams ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Water ----

export async function addWater(userId: string, ml: number, date = localDateString()) {
  return prisma.waterLog.create({
    data: { userId, ml: Math.round(ml), date },
  });
}

export async function getWaterForDate(userId: string, date = localDateString()): Promise<number> {
  const result = await prisma.waterLog.aggregate({
    where: { userId, date },
    _sum: { ml: true },
  });
  return result._sum.ml ?? 0;
}

export async function getWaterTarget(userId: string): Promise<number> {
  const setting = await prisma.reminderSetting.findUnique({ where: { userId } });
  return setting?.waterTargetMl ?? 3000;
}

export async function resetWaterForDate(userId: string, date = localDateString()) {
  return prisma.waterLog.deleteMany({ where: { userId, date } });
}

export async function undoLastWater(userId: string, date = localDateString()) {
  const last = await prisma.waterLog.findFirst({
    where: { userId, date },
    orderBy: { recordedAt: "desc" },
  });
  if (!last) return null;
  await prisma.waterLog.delete({ where: { id: last.id } });
  return last;
}

// ---- Reminder settings ----

export async function getReminderSetting(userId: string) {
  return prisma.reminderSetting.findUnique({ where: { userId } });
}

export async function upsertReminderSetting(
  userId: string,
  chatId: number,
  data: Partial<{
    workoutEnabled: boolean;
    proteinEnabled: boolean;
    workoutHour: number;
    proteinHour: number;
    proteinTarget: number;
    backupEnabled: boolean;
    digestEnabled: boolean;
    supplementsEnabled: boolean;
    supplementsHour: number;
    waterEnabled: boolean;
    waterTargetMl: number;
  }> = {},
) {
  return prisma.reminderSetting.upsert({
    where: { userId },
    update: { chatId: BigInt(chatId), ...data },
    create: { userId, chatId: BigInt(chatId), ...data },
  });
}

export async function getActiveReminderSettings() {
  return prisma.reminderSetting.findMany({
    include: { user: true },
  });
}

export async function getProteinTarget(userId: string): Promise<number> {
  const setting = await prisma.reminderSetting.findUnique({ where: { userId } });
  return setting?.proteinTarget ?? 160;
}
