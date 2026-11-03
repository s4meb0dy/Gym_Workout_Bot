import { prisma } from "../db/client";
import { generateHealthAdvice } from "./health-coach.service";
import { buildHealthContext, getHealthLog } from "./health.service";
import { estimateEnergy, macroSplit, parseGoal } from "./energy.service";
import { buildMeasurementsView } from "./measurements.service";
import {
  getCalorieTarget,
  getMacrosForDate,
  getNutritionEntries,
  getProteinTarget,
  localDateString,
  shiftDateString,
} from "./tracking.service";

export function isValidDay(date: unknown): date is string {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= localDateString();
}

/** Останні унікальні страви — для швидкого повторного додавання одним натиском. */
async function getRecentFoods(userId: string, limit = 8) {
  const rows = await prisma.nutritionLog.findMany({
    where: { userId, calories: { gt: 0 }, label: { not: null } },
    orderBy: { recordedAt: "desc" },
    take: 80,
  });

  const seen = new Set<string>();
  const foods = [];
  for (const row of rows) {
    const key = row.label!.trim().toLowerCase();
    if (seen.has(key) || key === "їжа (вручну)") continue;
    seen.add(key);
    foods.push({
      label: row.label!,
      calories: Math.round(row.calories),
      protein: Math.round(row.proteinGrams),
      fat: Math.round(row.fatGrams),
      carbs: Math.round(row.carbsGrams),
    });
    if (foods.length >= limit) break;
  }
  return foods;
}

async function getWeightView(userId: string) {
  const rows = await prisma.bodyWeight.findMany({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    take: 60,
  });
  const points = rows.reverse().map((r) => ({ id: r.id, date: r.recordedAt, weightKg: r.weightKg }));
  return { points };
}

export async function buildDayView(userId: string, date: string) {
  const [macros, calorieTarget, proteinTarget, entries, recentFoods, weight, health, previous] =
    await Promise.all([
      getMacrosForDate(userId, date),
      getCalorieTarget(userId),
      getProteinTarget(userId),
      getNutritionEntries(userId, date),
      getRecentFoods(userId),
      getWeightView(userId),
      getHealthLog(userId, date),
      getNutritionEntries(userId, shiftDateString(date, -1)),
    ]);
  const [energy, user, reminder, measurements] = await Promise.all([
    estimateEnergy(userId),
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.reminderSetting.findUnique({ where: { userId } }),
    buildMeasurementsView(userId),
  ]);

  const toView = (e: (typeof entries)[number]) => ({
    id: e.id,
    label: e.label ?? (e.calories > 0 ? "Їжа" : "Білок"),
    calories: Math.round(e.calories),
    protein: Math.round(e.proteinGrams),
    fat: Math.round(e.fatGrams),
    carbs: Math.round(e.carbsGrams),
  });

  return {
    date,
    isToday: date === localDateString(),
    targets: {
      calories: calorieTarget,
      protein: proteinTarget,
      fat: reminder?.fatTarget ?? 70,
      carbs: reminder?.carbsTarget ?? 300,
    },
    // Рекомендований розподіл БЖВ під поточну ціль калорій і останню вагу.
    recommendedSplit: weight.points.length
      ? macroSplit(calorieTarget, weight.points[weight.points.length - 1].weightKg, parseGoal(user?.goal))
      : null,
    macros,
    entries: entries.map(toView),
    previousEntries: previous.map(toView),
    recentFoods,
    weight,
    energy,
    measurements,
    profile: {
      heightCm: user?.heightCm ?? null,
      goal: parseGoal(user?.goal),
      weighInReminder: reminder?.weightEnabled ?? true,
      weighInHour: reminder?.weightHour ?? 8,
    },
    health: health
      ? {
          sleepMinutes: health.sleepMinutes,
          restingHr: health.restingHr,
          hrv: health.hrv,
          steps: health.steps,
          activeCalories: health.activeCalories,
          source: health.source,
        }
      : null,
  };
}

export async function buildAdvice(userId: string, date: string): Promise<string | null> {
  const ctx = await buildHealthContext(userId, date);
  if (!ctx) return null;
  const advice = await generateHealthAdvice(ctx);
  return advice.replace(/<[^>]+>/g, "").trim();
}
