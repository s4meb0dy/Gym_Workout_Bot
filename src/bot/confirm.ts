import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "./bot";

export function confirmActionKeyboard(actionKey: string) {
  return new InlineKeyboard()
    .text("✅ Так", `cfm:${actionKey}`)
    .text("❌ Ні", "cfm_noop");
}

export async function askConfirm(ctx: BotContext, text: string, actionKey: string) {
  await ctx.answerCallbackQuery();
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: confirmActionKeyboard(actionKey) });
}

export function registerConfirmHandlers(bot: Bot<BotContext>) {
  bot.callbackQuery("cfm_noop", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Скасовано" });
    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }
  });
}
