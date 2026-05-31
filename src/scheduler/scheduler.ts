import cron from "node-cron";
import { Bot } from "grammy";
import { BotContext } from "../bot/bot";
import { config } from "../config/env";
import {
  getActiveReminderSettings,
  getProteinForDate,
  getWaterForDate,
} from "../services/tracking.service";
import { getWorkoutDayByNumber } from "../services/workout.service";
import { buildBackupFile, backupExists } from "../services/backup.service";
import { buildWeeklyDigest } from "../services/digest.service";

const WEEKDAY_TO_DAY_NUMBER: Record<string, number> = {
  Mon: 1,
  Wed: 2,
  Fri: 3,
  Sun: 4,
};

const BACKUP_HOUR = 3;
const DIGEST_WEEKDAY = "Sun";
const DIGEST_HOUR = 19;
const WATER_REMINDER_HOURS = [12, 16, 20];

function formatMlShort(ml: number): string {
  return ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)} л` : `${ml} мл`;
}

function getLocalHour(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

function getLocalWeekday(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    weekday: "short",
  }).format(new Date());
}

async function runHourlyReminders(bot: Bot<BotContext>): Promise<void> {
  const hour = getLocalHour();
  const weekday = getLocalWeekday();
  const workoutDayNumber = WEEKDAY_TO_DAY_NUMBER[weekday];

  const settings = await getActiveReminderSettings();

  for (const setting of settings) {
    const chatId = Number(setting.chatId);

    try {
      if (setting.workoutEnabled && hour === setting.workoutHour && workoutDayNumber) {
        const day = await getWorkoutDayByNumber(workoutDayNumber);
        if (day) {
          await bot.api.sendMessage(
            chatId,
            `🏋️ Сьогодні тренування: <b>${day.weekday} — ${day.name}</b>.\n` +
              "Натисни /workout, коли будеш у залі. Гарного тренування! 💪",
            { parse_mode: "HTML" },
          );
        }
      }

      if (setting.supplementsEnabled && hour === setting.supplementsHour) {
        await bot.api.sendMessage(
          chatId,
          "💊 Час прийняти добавки:\n• Омега-3\n• Магній малат\n• Вітамін D-3",
        );
      }

      if (setting.proteinEnabled && hour === setting.proteinHour) {
        const total = await getProteinForDate(setting.userId);
        const left = Math.max(0, setting.proteinTarget - total);
        const message =
          left > 0
            ? `🍗 Білок сьогодні: <b>${Math.round(total)}/${setting.proteinTarget} г</b>. ` +
              `Залишилось ще <b>${Math.round(left)} г</b> — встигни добрати!`
            : `🍗 Чудово! Ціль ${setting.proteinTarget} г білка вже досягнута (${Math.round(total)} г). 💪`;
        await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
      }

      if (setting.waterEnabled && WATER_REMINDER_HOURS.includes(hour)) {
        const drunk = await getWaterForDate(setting.userId);
        const left = setting.waterTargetMl - drunk;
        if (left > 0) {
          await bot.api.sendMessage(
            chatId,
            `💧 Вода: <b>${formatMlShort(drunk)}/${formatMlShort(setting.waterTargetMl)}</b>. ` +
              `Залишилось <b>${formatMlShort(left)}</b> — зроби кілька ковтків! Додати: /water`,
            { parse_mode: "HTML" },
          );
        } else if (hour === WATER_REMINDER_HOURS[0]) {
          await bot.api.sendMessage(
            chatId,
            `💧 Ціль по воді вже виконана (${formatMlShort(drunk)}). Чудово! 👏`,
          );
        }
      }

      if (setting.backupEnabled && hour === BACKUP_HOUR && backupExists()) {
        await bot.api.sendDocument(chatId, buildBackupFile(), {
          caption: "💾 Щоденний автоматичний бекап бази даних.",
        });
      }

      if (setting.digestEnabled && weekday === DIGEST_WEEKDAY && hour === DIGEST_HOUR) {
        const digest = await buildWeeklyDigest(setting.userId);
        await bot.api.sendMessage(chatId, digest, { parse_mode: "HTML" });
      }
    } catch (error) {
      console.error(`Scheduler: failed to notify chat ${chatId}:`, error);
    }
  }
}

export function startScheduler(bot: Bot<BotContext>): void {
  if (!config.enableScheduler) {
    console.log("Scheduler disabled (ENABLE_SCHEDULER=false).");
    return;
  }

  cron.schedule(
    "0 * * * *",
    () => {
      runHourlyReminders(bot).catch((error) =>
        console.error("Scheduler run failed:", error),
      );
    },
    { timezone: config.timezone },
  );

  console.log(`Scheduler started (timezone: ${config.timezone}).`);
}
