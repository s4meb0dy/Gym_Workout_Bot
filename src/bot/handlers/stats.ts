import { Bot } from "grammy";
import { BotContext } from "../bot";
import { backToMenuKeyboard } from "../keyboards";
import { formatWeight } from "../../services/progression";
import { findOrCreateUser, getUserStats } from "../../services/workout.service";

export async function showStats(ctx: BotContext) {
  if (!ctx.from) {
    return;
  }

  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const stats = await getUserStats(user.id);

  let text =
    `<b>📊 Статистика</b>\n\n` +
    `Завершених тренувань: ${stats.totalWorkouts}\n` +
    `Всього підходів: ${stats.totalSets}\n` +
    `Загальний тоннаж: ${formatWeight(stats.totalTonnage)} кг\n`;

  if (stats.records.length > 0) {
    text += `\n<b>🏆 Особисті рекорди:</b>\n`;
    for (const record of stats.records.slice(0, 10)) {
      text += `• ${record.exerciseName}: ${formatWeight(record.weight)} кг × ${record.reps}\n`;
    }
  }

  if (stats.recentSessions.length > 0) {
    text += `\n<b>Останні тренування:</b>\n`;
    for (const session of stats.recentSessions) {
      const date = session.date.toLocaleDateString("uk-UA");
      text += `• ${session.dayName} (${date}) — ${session.sets} підх., ${formatWeight(session.tonnage)} кг\n`;
    }
  }

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: backToMenuKeyboard(),
  });
}

export function registerStatsHandlers(bot: Bot<BotContext>) {
  bot.command("stats", (ctx) => showStats(ctx));
}
