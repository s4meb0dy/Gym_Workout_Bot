import { Bot, Context, session, SessionFlavor } from "grammy";
import { config } from "../config/env";
import { findOrCreateUser } from "../services/workout.service";
import { registerMenuHandlers } from "./handlers/menu";
import { registerProgramHandlers } from "./handlers/program";
import { registerStatsHandlers } from "./handlers/stats";
import { registerWorkoutHandlers } from "./handlers/workout";
import { registerTrackingHandlers } from "./handlers/tracking";
import { registerFoodHandlers } from "./handlers/food";
import { registerWaterHandlers } from "./handlers/water";
import { registerAnalyticsHandlers } from "./handlers/analytics";
import { registerToolsHandlers } from "./handlers/tools";
import { registerHistoryHandlers } from "./handlers/history";
import { registerEditProgramHandlers } from "./handlers/editprogram";
import { mainMenuKeyboard } from "./keyboards";

export interface PendingFood {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  label: string;
}

export interface SessionData {
  awaitingSetInput: boolean;
  awaitingInput?: "weight" | "protein" | "food_macros" | "water" | null;
  editingSetId?: string | null;
  quickWeight?: number | null;
  editProgram?: { mode: "rename" | "add"; dayNumber: number; exerciseId?: number } | null;
  pendingFood?: PendingFood | null;
}

export type BotContext = Context & SessionFlavor<SessionData>;

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.botToken);

  bot.use(
    session({
      initial: (): SessionData => ({
        awaitingSetInput: false,
        awaitingInput: null,
        editingSetId: null,
        quickWeight: null,
        editProgram: null,
        pendingFood: null,
      }),
    }),
  );

  bot.use(async (ctx, next) => {
    if (!ctx.from) {
      return;
    }

    await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    await next();
  });

  bot.command("start", async (ctx) => {
    ctx.session.awaitingSetInput = false;
    ctx.session.awaitingInput = null;
    ctx.session.editingSetId = null;

    if (ctx.from && ctx.chat) {
      const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
      const { upsertReminderSetting } = await import("../services/tracking.service");
      await upsertReminderSetting(user.id, ctx.chat.id);
    }

    await ctx.reply(
      `Привіт, ${ctx.from?.first_name ?? "атлет"}! 👋\n\n` +
        "Я допоможу відстежувати силові тренування, прогресію ваги, вагу тіла, білок і нагадування.\n\n" +
        "Обери дію в меню:",
      { reply_markup: mainMenuKeyboard },
    );
  });

  registerMenuHandlers(bot);
  registerTrackingHandlers(bot);
  registerFoodHandlers(bot);
  registerWaterHandlers(bot);
  registerAnalyticsHandlers(bot);
  registerToolsHandlers(bot);
  registerHistoryHandlers(bot);
  registerEditProgramHandlers(bot);
  registerWorkoutHandlers(bot);
  registerProgramHandlers(bot);
  registerStatsHandlers(bot);

  bot.catch((error) => {
    console.error("Bot error:", error);
  });

  return bot;
}

async function assertBotTokenValid(bot: Bot<BotContext>): Promise<void> {
  try {
    await bot.api.getMe();
  } catch (error) {
    console.error("\n❌ Telegram rejected BOT_TOKEN (401 Unauthorized).\n");
    console.error("Fix it:");
    console.error("  1. Open @BotFather in Telegram");
    console.error("  2. Send /mybots → choose your bot → API Token");
    console.error("  3. Copy the token exactly (no spaces or quotes)");
    console.error("  4. Paste into .env as BOT_TOKEN=... and restart\n");
    console.error("If the token was shared publicly, use /revoke in @BotFather and generate a new one.\n");
    throw error;
  }
}

export async function startBot(bot: Bot<BotContext>): Promise<void> {
  await assertBotTokenValid(bot);

  await bot.api.setMyCommands([
    { command: "start", description: "Головне меню" },
    { command: "workout", description: "Розпочати тренування" },
    { command: "program", description: "Моя програма" },
    { command: "stats", description: "Статистика" },
    { command: "weight", description: "Записати вагу тіла" },
    { command: "protein", description: "Додати білок за сьогодні" },
    { command: "water", description: "Трекінг води" },
    { command: "food", description: "КБЖВ за фото / підсумок дня" },
    { command: "volume", description: "Обсяг по м'язах за тиждень" },
    { command: "progress", description: "Графік прогресу вправи" },
    { command: "history", description: "Історія тренувань" },
    { command: "digest", description: "Тижневий підсумок" },
    { command: "editprogram", description: "Редагувати програму" },
    { command: "reminders", description: "Нагадування" },
    { command: "backup", description: "Бекап бази даних" },
    { command: "export", description: "Експорт історії у CSV" },
  ]);

  bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is running`);
    },
  });
}
