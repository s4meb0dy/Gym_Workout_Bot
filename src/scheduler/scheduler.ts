import cron from "node-cron";
import { Bot } from "grammy";
import { BotContext } from "../bot/bot";
import { config, isAllowedUser } from "../config/env";
import {
  getActiveReminderSettings,
  getProteinForDate,
} from "../services/tracking.service";
import { getWorkoutDayByNumber } from "../services/workout.service";
import { createBackupFile, backupExists } from "../services/backup.service";
import { buildWeeklyDigest } from "../services/digest.service";
import { buildMeasurementsView, MEASURE_WEEKDAY } from "../services/measurements.service";
import { checkStaleWorkouts } from "./stale-workouts";
import { InlineKeyboard } from "grammy";
import { getWebAppUrl } from "../bot/webapp-button";
import { hasWeighedToday } from "../services/energy.service";

const WEEKDAY_TO_DAY_NUMBER: Record<string, number> = {
  Mon: 1,
  Wed: 2,
  Fri: 3,
  Sun: 4,
};

const BACKUP_HOUR = 3;
const DIGEST_WEEKDAY = "Sun";
const DIGEST_HOUR = 19;

/** Жиророзчинні (D3, омега) засвоюються з їжею, тому — з найжирнішим прийомом. */
const DAY_SUPPLEMENTS =
  "💊 <b>Добавки — з найжирнішим прийомом їжі</b>\n" +
  "• Омега-3 (Olimp) — 2 капс.\n" +
  "• D3 2000 IU — 2 капс.\n" +
  "• Метилфолат 400 мкг — 1 табл.\n" +
  "• Креатин — 5 г (якщо ще не випив)";

const NIGHT_SUPPLEMENTS = "😴 <b>Перед сном</b>\n• Магній бісгліцинат — 2 капс.";

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
    if (!isAllowedUser(setting.user.telegramId)) {
      continue;
    }

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

      if (setting.weightEnabled && hour === setting.weightHour && !(await hasWeighedToday(setting.userId))) {
        const url = getWebAppUrl();
        await bot.api.sendMessage(
          chatId,
          "⚖️ Зважся натще — після туалету, до їжі й води. Щоденні зважування дають точну норму калорій для набору без жиру.\n" +
            "Записати: <code>/weight 70.2</code> або у вкладці «День».",
          {
            parse_mode: "HTML",
            reply_markup: url ? new InlineKeyboard().webApp("📱 Записати в застосунку", url) : undefined,
          },
        );
      }

      if (setting.weightEnabled && hour === setting.weightHour && weekday === MEASURE_WEEKDAY) {
        const measurements = await buildMeasurementsView(setting.userId);
        if (measurements.due) {
          const url = getWebAppUrl();
          await bot.api.sendMessage(
            chatId,
            "📏 <b>Неділя — день замірів.</b> Натще, після туалету, стрічка горизонтально, живіт не втягувати:\n" +
              "• талія на рівні пупка (головне)\n• за бажанням — груди, плечі, рука, стегно\n\n" +
              "Записати — вкладка «День» → Заміри.",
            {
              parse_mode: "HTML",
              reply_markup: url ? new InlineKeyboard().webApp("📱 Записати в застосунку", url) : undefined,
            },
          );
        }
      }

      if (setting.supplementsEnabled && hour === setting.supplementsHour) {
        await bot.api.sendMessage(chatId, DAY_SUPPLEMENTS, { parse_mode: "HTML" });
      }

      if (setting.supplementsEnabled && hour === setting.magnesiumHour) {
        await bot.api.sendMessage(chatId, NIGHT_SUPPLEMENTS, { parse_mode: "HTML" });
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

      if (setting.backupEnabled && hour === BACKUP_HOUR && backupExists()) {
        const backup = await createBackupFile();
        try {
          await bot.api.sendDocument(chatId, backup.file, {
            caption: "💾 Щоденний автоматичний бекап бази даних.",
          });
        } finally {
          backup.cleanup();
        }
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

  cron.schedule("*/10 * * * *", () => {
    checkStaleWorkouts(bot).catch((error) => console.error("Stale workout check failed:", error));
  });

  console.log(`Scheduler started (timezone: ${config.timezone}).`);
}
