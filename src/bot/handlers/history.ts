import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../bot";
import { backToMenuKeyboard } from "../keyboards";
import { findOrCreateUser } from "../../services/workout.service";
import { getCompletedSessions, getSessionDetail } from "../../services/analytics.service";
import { formatDisplayDate } from "../../services/tracking.service";
import { formatWeight } from "../../services/progression";

async function showHistory(ctx: BotContext) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const sessions = await getCompletedSessions(user.id, 10);

  if (sessions.length === 0) {
    await ctx.reply("Завершених тренувань ще немає.", { reply_markup: backToMenuKeyboard() });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const s of sessions) {
    keyboard
      .text(
        `${formatDisplayDate(s.date)} · ${s.dayName} (${s.sets} підх.)`,
        `hist:${s.id}`,
      )
      .row();
  }

  await ctx.reply("📜 <b>Останні тренування</b>\nОбери, щоб переглянути деталі:", {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

async function showSessionDetail(ctx: BotContext, sessionId: string) {
  const session = await getSessionDetail(sessionId);
  if (!session) {
    await ctx.reply("Тренування не знайдено.");
    return;
  }

  let text = `📜 <b>${session.workoutDay.name}</b>\n${formatDisplayDate(session.completedAt ?? session.startedAt)}\n\n`;

  let currentExerciseId = -1;
  let tonnage = 0;
  for (const set of session.sets) {
    if (set.weight <= 0 || set.reps <= 0) {
      continue;
    }
    if (set.exerciseId !== currentExerciseId) {
      currentExerciseId = set.exerciseId;
      text += `\n<b>${set.exercise.name}</b>\n`;
    }
    tonnage += set.weight * set.reps;
    let line = `  №${set.setNumber}: ${formatWeight(set.weight)} кг × ${set.reps}`;
    if (set.rpe) {
      line += ` • RPE ${formatWeight(set.rpe)}`;
    }
    if (set.note) {
      line += ` • ${set.note}`;
    }
    text += `${line}\n`;
  }

  text += `\n⚖️ Тоннаж: <b>${formatWeight(tonnage)} кг</b>`;

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: backToMenuKeyboard() });
}

export function registerHistoryHandlers(bot: Bot<BotContext>) {
  bot.command("history", (ctx) => showHistory(ctx));

  bot.callbackQuery("tools_history", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showHistory(ctx);
  });

  bot.callbackQuery(/^hist:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showSessionDetail(ctx, ctx.match![1]);
  });
}
