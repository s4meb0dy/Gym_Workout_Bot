import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../bot/bot";
import { clearRest } from "../bot/rest-timer";
import { getWebAppUrl } from "../bot/webapp-button";
import { config, isAllowedUser } from "../config/env";
import { prisma } from "../db/client";
import { completeWorkoutSession, formatWorkoutSummary } from "../services/workout.service";

/** Без нових підходів стільки хвилин — нагадуємо завершити. */
const REMIND_AFTER_MIN = 60;
/** А стільки — завершуємо самі, щоб забуте тренування не псувало статистику. */
const AUTO_CLOSE_AFTER_MIN = 180;

// Нагадування надсилаємо один раз на сесію; після рестарту воно може повторитися — не страшно.
const reminded = new Set<string>();

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export async function checkStaleWorkouts(bot: Bot<BotContext>): Promise<void> {
  const sessions = await prisma.workoutSession.findMany({
    where: { completedAt: null },
    include: {
      user: true,
      workoutDay: true,
      sets: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const now = Date.now();
  for (const session of sessions) {
    if (!isAllowedUser(session.user.telegramId)) continue;

    const chatId = Number(session.user.telegramId);
    const lastActivity = session.sets[0]?.createdAt ?? session.startedAt;
    const idleMin = (now - lastActivity.getTime()) / 60000;

    try {
      if (idleMin >= AUTO_CLOSE_AFTER_MIN) {
        reminded.delete(session.id);
        clearRest(chatId);

        if (session.sets.length === 0) {
          await prisma.workoutSession.delete({ where: { id: session.id } });
          await bot.api.sendMessage(
            chatId,
            `🗑 Порожнє тренування «${session.workoutDay.name}» скасовано — підходів не було ${Math.floor(idleMin / 60)} год.`,
          );
          continue;
        }

        // Час завершення — останній підхід, а не «зараз», щоб тривалість була справжньою.
        const summary = await completeWorkoutSession(session.id, lastActivity);
        await bot.api.sendMessage(
          chatId,
          `⏹ <b>Тренування завершено автоматично</b> — після останнього підходу о ${fmtTime(lastActivity)} ` +
            `минуло понад ${AUTO_CLOSE_AFTER_MIN / 60} год.\n\n${formatWorkoutSummary(summary)}`,
          { parse_mode: "HTML" },
        );
        continue;
      }

      if (idleMin >= REMIND_AFTER_MIN && !reminded.has(session.id)) {
        reminded.add(session.id);
        const keyboard = new InlineKeyboard().text("✅ Завершити", "finish_workout");
        const url = getWebAppUrl();
        if (url) keyboard.webApp("📱 Відкрити", url);

        await bot.api.sendMessage(
          chatId,
          `⏳ Тренування «${session.workoutDay.name}» досі відкрите — останній підхід о ${fmtTime(lastActivity)}.\n` +
            `Якщо вже закінчив — заверши його. Інакше через ${Math.round((AUTO_CLOSE_AFTER_MIN - idleMin) / 60 * 10) / 10} год я завершу сам.`,
          { reply_markup: keyboard },
        );
      }
    } catch (error) {
      console.error(`Stale workout check failed for session ${session.id}:`, error);
    }
  }
}
