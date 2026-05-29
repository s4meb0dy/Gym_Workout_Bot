import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../bot";
import { backToMenuKeyboard } from "../keyboards";
import { buildLineChartUrl } from "../../services/chart.service";
import { findOrCreateUser } from "../../services/workout.service";
import {
  getExercisesWithHistory,
  getOneRmHistory,
  getWeeklyVolume,
} from "../../services/analytics.service";
import { buildWeeklyDigest } from "../../services/digest.service";
import { formatDisplayDate } from "../../services/tracking.service";
import { formatWeight } from "../../services/progression";

async function showVolume(ctx: BotContext) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const volume = await getWeeklyVolume(user.id, 7);

  if (volume.length === 0) {
    await ctx.reply(
      "📈 За останні 7 днів немає завершених тренувань. Заверши тренування — і тут зʼявиться обсяг по м'язах.",
      { reply_markup: backToMenuKeyboard() },
    );
    return;
  }

  const totalSets = volume.reduce((sum, v) => sum + v.sets, 0);
  let text = `📈 <b>Обсяг за 7 днів</b>\nВсього робочих підходів: <b>${totalSets}</b>\n\n`;
  for (const group of volume) {
    text += `• ${group.muscleGroup}: <b>${group.sets}</b> підх. (${formatWeight(group.tonnage)} кг)\n`;
  }
  text +=
    "\n<i>Орієнтир для росту: ~10–20 робочих підходів на велику групу за тиждень.</i>";

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: backToMenuKeyboard() });
}

async function showProgressPicker(ctx: BotContext) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const exercises = await getExercisesWithHistory(user.id);

  if (exercises.length === 0) {
    await ctx.reply("Поки немає історії з вагою. Заверши кілька тренувань.", {
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const ex of exercises.slice(0, 12)) {
    keyboard.text(`${ex.name} (${ex.sessions})`, `prog_ex:${ex.exerciseId}`).row();
  }

  await ctx.reply("🏆 Обери вправу для графіка прогресу (оцінка 1ПМ):", {
    reply_markup: keyboard,
  });
}

async function showProgressChart(ctx: BotContext, exerciseId: number) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const history = await getOneRmHistory(user.id, exerciseId);

  if (history.length === 0) {
    await ctx.reply("Немає даних для цієї вправи.");
    return;
  }

  const latest = history[history.length - 1];

  if (history.length < 2) {
    await ctx.reply(
      `🏆 Поки лише одне тренування.\nОцінка 1ПМ: <b>${formatWeight(latest.oneRm)} кг</b> ` +
        `(${formatWeight(latest.bestWeight)} × ${latest.bestReps}).`,
      { parse_mode: "HTML", reply_markup: backToMenuKeyboard() },
    );
    return;
  }

  const labels = history.map((p) => formatDisplayDate(p.date));
  const values = history.map((p) => p.oneRm);
  const chartUrl = buildLineChartUrl("Оцінка 1ПМ, кг", labels, [
    { label: "1ПМ", data: values, color: "#16a34a" },
  ]);

  const diff = Math.round((values[values.length - 1] - values[0]) * 10) / 10;
  const trend = diff > 0 ? `+${diff} кг 📈` : diff < 0 ? `${diff} кг 📉` : "без змін";

  await ctx.replyWithPhoto(chartUrl, {
    caption:
      `Поточна оцінка 1ПМ: <b>${formatWeight(latest.oneRm)} кг</b>\n` +
      `Останній підхід: ${formatWeight(latest.bestWeight)} × ${latest.bestReps}\n` +
      `Прогрес за період: <b>${trend}</b>`,
    parse_mode: "HTML",
  });
}

export function registerAnalyticsHandlers(bot: Bot<BotContext>) {
  bot.command("volume", (ctx) => showVolume(ctx));
  bot.command("progress", (ctx) => showProgressPicker(ctx));

  bot.command("digest", async (ctx) => {
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const text = await buildWeeklyDigest(user.id);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: backToMenuKeyboard() });
  });

  bot.callbackQuery("tools_volume", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showVolume(ctx);
  });

  bot.callbackQuery("tools_digest", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const text = await buildWeeklyDigest(user.id);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: backToMenuKeyboard() });
  });

  bot.callbackQuery("tools_progress", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProgressPicker(ctx);
  });

  bot.callbackQuery(/^prog_ex:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProgressChart(ctx, Number(ctx.match![1]));
  });
}
