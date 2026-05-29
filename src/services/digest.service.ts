import { prisma } from "../db/client";
import { getWeeklyVolume } from "./analytics.service";
import { getProteinHistory, getProteinTarget, formatDisplayDate } from "./tracking.service";
import { formatWeight } from "./progression";

export async function buildWeeklyDigest(userId: string): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const workouts = await prisma.workoutSession.count({
    where: { userId, completedAt: { not: null, gte: since } },
  });

  const volume = await getWeeklyVolume(userId, 7);
  const totalSets = volume.reduce((sum, v) => sum + v.sets, 0);

  const weights = await prisma.bodyWeight.findMany({
    where: { userId, recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
  });

  const proteinHistory = await getProteinHistory(userId, 7);
  const target = await getProteinTarget(userId);

  let text = "📅 <b>Тижневий підсумок</b>\n\n";

  text += `🏋️ Тренувань: <b>${workouts}</b>\n`;
  text += `📊 Робочих підходів: <b>${totalSets}</b>\n`;

  if (weights.length >= 2) {
    const diff = Math.round((weights[weights.length - 1].weightKg - weights[0].weightKg) * 10) / 10;
    const sign = diff > 0 ? `+${diff}` : `${diff}`;
    text += `⚖️ Вага: ${weights[weights.length - 1].weightKg} кг (${sign} кг за тиждень)\n`;
  } else if (weights.length === 1) {
    text += `⚖️ Вага: ${weights[0].weightKg} кг\n`;
  }

  if (proteinHistory.length > 0) {
    const avg = Math.round(
      proteinHistory.reduce((sum, d) => sum + d.total, 0) / proteinHistory.length,
    );
    const daysHit = proteinHistory.filter((d) => d.total >= target).length;
    text += `🍗 Білок: середнє ${avg} г/день, ціль (${target} г) виконано ${daysHit}/${proteinHistory.length} дн.\n`;
  }

  const calorieDays = await prisma.nutritionLog.groupBy({
    by: ["date"],
    where: { userId, recordedAt: { gte: since }, calories: { gt: 0 } },
    _sum: { calories: true },
  });
  if (calorieDays.length > 0) {
    const avgCalories = Math.round(
      calorieDays.reduce((sum, d) => sum + (d._sum.calories ?? 0), 0) / calorieDays.length,
    );
    text += `🔥 Калорії: середнє ${avgCalories} ккал/день (${calorieDays.length} дн. з даними)\n`;
  }

  if (volume.length > 0) {
    text += "\n<b>Обсяг по м'язах:</b>\n";
    for (const group of volume) {
      text += `• ${group.muscleGroup}: ${group.sets} підх.\n`;
    }
  }

  if (workouts === 0) {
    text += "\nЦього тижня без тренувань — наступний тиждень точно буде кращим! 💪";
  } else {
    text += `\nГарна робота! Тримай курс 💪`;
  }

  text += `\n\n<i>Станом на ${formatDisplayDate(new Date())}</i>`;
  return text;
}
