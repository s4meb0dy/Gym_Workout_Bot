import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../bot";
import { backToMenuKeyboard } from "../keyboards";
import { generateHealthAdvice, buildShortcutInstructions } from "../../services/health-coach.service";
import {
  buildHealthContext,
  ensureHealthSyncToken,
  formatHealthSummary,
  getHealthHistory,
  getHealthLog,
  parseHealthInput,
  upsertHealthLog,
} from "../../services/health.service";
import { findOrCreateUser } from "../../services/workout.service";
import { getPublicAppUrl } from "../../config/env";
import { localDateString } from "../../services/tracking.service";

function healthMenuKeyboard() {
  return new InlineKeyboard()
    .text("🧠 Поради на сьогодні", "health_advice")
    .row()
    .text("📲 Налаштувати синхронізацію", "health_setup")
    .row()
    .text("📜 Історія (7 днів)", "health_history")
    .row()
    .text("🏠 Головне меню", "back_to_menu");
}

async function showHealthMenu(ctx: BotContext) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const log = await getHealthLog(user.id);

  let text = "⌚ <b>Apple Watch / Здоров'я</b>\n\n";
  if (log) {
    text += formatHealthSummary(log) + "\n\n";
  } else {
    text += "Даних ще немає.\n\n";
  }

  text +=
    "<b>Вручну:</b> <code>/watch 7:30 58 42 8500</code>\n" +
    "(сон, пульс, hrv, кроки)\n\n" +
    "Або налаштуй автосинхронізацію з iPhone Shortcuts.";

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: healthMenuKeyboard() });
}

export function registerHealthHandlers(bot: Bot<BotContext>) {
  bot.command("watch", async (ctx) => {
    const arg = ctx.match?.trim();
    if (!arg) {
      await showHealthMenu(ctx);
      return;
    }

    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);

    if (arg.toLowerCase() === "setup") {
      const token = await ensureHealthSyncToken(user.id);
      const url = `${getPublicAppUrl()}/api/health/sync`;
      await ctx.reply(buildShortcutInstructions(url, token), { parse_mode: "HTML" });
      return;
    }

    if (arg.toLowerCase() === "advice") {
      const healthCtx = await buildHealthContext(user.id, localDateString());
      if (!healthCtx) {
        await ctx.reply("Спочатку додай дані: /watch 7:30 58 42 8500 або налаштуй синхронізацію.");
        return;
      }
      const thinking = await ctx.reply("🧠 Аналізую показники...");
      const advice = await generateHealthAdvice(healthCtx);
      await ctx.api.editMessageText(thinking.chat.id, thinking.message_id, `🧠 <b>Поради на сьогодні</b>\n\n${advice}`, {
        parse_mode: "HTML",
      });
      return;
    }

    const parsed = parseHealthInput(arg);
    if (!parsed) {
      await ctx.reply(
        "Не розпізнав формат.\n\n" +
          "Приклади:\n" +
          "<code>/watch 7:30 58 42 8500</code>\n" +
          "<code>/watch сон 7:30 пульс 58 hrv 42 кроки 8500</code>",
        { parse_mode: "HTML" },
      );
      return;
    }

    const log = await upsertHealthLog(user.id, parsed.date, parsed.metrics, "manual");
    await ctx.reply(`✅ Записано:\n\n${formatHealthSummary(log)}`, { parse_mode: "HTML" });

    if (parsed.date === localDateString()) {
      const healthCtx = await buildHealthContext(user.id, parsed.date);
      if (healthCtx) {
        const advice = await generateHealthAdvice(healthCtx);
        await ctx.reply(`🧠 <b>Поради на сьогодні</b>\n\n${advice}`, { parse_mode: "HTML" });
      }
    }
  });

  bot.callbackQuery("health_advice", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const healthCtx = await buildHealthContext(user.id, localDateString());
    if (!healthCtx) {
      await ctx.reply("Спочатку додай дані через /watch або синхронізацію.");
      return;
    }
    const thinking = await ctx.reply("🧠 Аналізую показники...");
    const advice = await generateHealthAdvice(healthCtx);
    await ctx.api.editMessageText(thinking.chat.id, thinking.message_id, `🧠 <b>Поради на сьогодні</b>\n\n${advice}`, {
      parse_mode: "HTML",
    });
  });

  bot.callbackQuery("health_setup", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const token = await ensureHealthSyncToken(user.id);
    const url = `${getPublicAppUrl()}/api/health/sync`;
    await ctx.reply(buildShortcutInstructions(url, token), { parse_mode: "HTML" });
  });

  bot.callbackQuery("health_history", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const history = await getHealthHistory(user.id, 7);
    if (history.length === 0) {
      await ctx.reply("Історії ще немає.", { reply_markup: backToMenuKeyboard() });
      return;
    }
    let text = "⌚ <b>Останні 7 днів</b>\n\n";
    for (const row of history) {
      text +=
        `${row.date}: 😴 ${row.sleepMinutes ? Math.round(row.sleepMinutes / 60) + "г" : "—"} | ` +
        `❤️ ${row.restingHr ?? "—"} | 👟 ${row.steps ?? "—"}\n`;
    }
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: backToMenuKeyboard() });
  });

  bot.callbackQuery("tools_health", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showHealthMenu(ctx);
  });
}
