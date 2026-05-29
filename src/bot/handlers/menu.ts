import { Bot } from "grammy";
import { mainMenuKeyboard } from "../keyboards";
import { BotContext } from "../bot";

export function registerMenuHandlers(bot: Bot<BotContext>) {
  const showMainMenu = async (ctx: BotContext, text = "Головне меню:") => {
    ctx.session.awaitingSetInput = false;
    await ctx.reply(text, { reply_markup: mainMenuKeyboard });
  };

  bot.command("menu", (ctx) => showMainMenu(ctx));

  bot.hears("🏋️ Розпочати тренування", async (ctx) => {
    const { workoutDayKeyboard } = await import("../keyboards");
    const { getWorkoutDays } = await import("../../services/workout.service");
    const days = await getWorkoutDays();
    await ctx.reply("Обери тренувальний день:", { reply_markup: workoutDayKeyboard(days) });
  });

  bot.hears("📋 Моя програма (4 дні)", async (ctx) => {
    const { programDayKeyboard } = await import("../keyboards");
    const { getWorkoutDays } = await import("../../services/workout.service");
    const days = await getWorkoutDays();
    await ctx.reply("Обери день, щоб переглянути програму:", {
      reply_markup: programDayKeyboard(days),
    });
  });

  bot.hears("📊 Статистика та рекорди", async (ctx) => {
    const { showStats } = await import("./stats");
    await showStats(ctx);
  });

  bot.callbackQuery("back_to_menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });
}
