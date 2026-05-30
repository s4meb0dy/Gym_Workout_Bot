import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../bot";
import { findOrCreateUser } from "../../services/workout.service";
import {
  addWater,
  getWaterForDate,
  getWaterTarget,
  resetWaterForDate,
  undoLastWater,
} from "../../services/tracking.service";

function formatMl(ml: number): string {
  if (ml >= 1000) {
    const liters = ml / 1000;
    return `${Number.isInteger(liters) ? liters : liters.toFixed(2).replace(/0$/, "")} л`;
  }
  return `${ml} мл`;
}

function progressBar(ratio: number, segments = 10): string {
  const filled = Math.max(0, Math.min(segments, Math.round(ratio * segments)));
  return "🟦".repeat(filled) + "⬜".repeat(segments - filled);
}

function waterKeyboard() {
  return new InlineKeyboard()
    .text("💧 +250 мл", "water_add:250")
    .text("💧 +500 мл", "water_add:500")
    .row()
    .text("💧 +750 мл", "water_add:750")
    .text("💧 +1 л", "water_add:1000")
    .row()
    .text("✍️ Інша к-сть", "water_custom")
    .row()
    .text("↩️ Скасувати останнє", "water_undo")
    .text("🔄 Скинути день", "water_reset");
}

async function showWater(ctx: BotContext, note?: string) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const total = await getWaterForDate(user.id);
  const target = await getWaterTarget(user.id);
  const ratio = target > 0 ? total / target : 0;
  const left = Math.max(0, target - total);

  const status =
    total >= target
      ? `🎉 Ціль ${formatMl(target)} виконана!`
      : `Залишилось <b>${formatMl(left)}</b> до цілі ${formatMl(target)}.`;

  const text =
    (note ? `${note}\n\n` : "") +
    `💧 <b>Вода сьогодні</b>\n` +
    `${progressBar(ratio)} ${Math.round(ratio * 100)}%\n` +
    `<b>${formatMl(total)}</b> / ${formatMl(target)}\n${status}`;

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: waterKeyboard() });
}

async function addAndRefresh(ctx: BotContext, ml: number) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  await addWater(user.id, ml);
  const total = await getWaterForDate(user.id);
  const target = await getWaterTarget(user.id);
  const ratio = target > 0 ? total / target : 0;
  const left = Math.max(0, target - total);

  const status =
    total >= target
      ? `🎉 Ціль ${formatMl(target)} виконана! Так тримати! 💪`
      : `Залишилось <b>${formatMl(left)}</b>.`;

  const header = ml > 0 ? `💧 <b>Вода сьогодні</b> (+${formatMl(ml)})` : "💧 <b>Вода сьогодні</b>";
  const text =
    `${header}\n` +
    `${progressBar(ratio)} ${Math.round(ratio * 100)}%\n` +
    `<b>${formatMl(total)}</b> / ${formatMl(target)}\n${status}`;

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: waterKeyboard() });
  } catch {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: waterKeyboard() });
  }
}

export function registerWaterHandlers(bot: Bot<BotContext>) {
  bot.command("water", (ctx) => showWater(ctx));
  bot.hears("💧 Вода", (ctx) => showWater(ctx));

  bot.callbackQuery(/^water_add:(\d+)$/, async (ctx) => {
    const ml = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: `+${formatMl(ml)}` });
    await addAndRefresh(ctx, ml);
  });

  bot.callbackQuery("water_custom", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.awaitingInput = "water";
    await ctx.reply(
      "Введи кількість води. Можна в мілілітрах (<code>350</code>) або літрах (<code>0.5</code>, <code>1.2</code>).",
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery("water_undo", async (ctx) => {
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const removed = await undoLastWater(user.id);
    await ctx.answerCallbackQuery({ text: removed ? `Прибрано ${formatMl(removed.ml)}` : "Немає що скасовувати" });
    if (removed) await addAndRefresh(ctx, 0);
  });

  bot.callbackQuery("water_reset", async (ctx) => {
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    await resetWaterForDate(user.id);
    await ctx.answerCallbackQuery({ text: "День обнулено" });
    await addAndRefresh(ctx, 0);
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.session.awaitingInput !== "water") {
      return next();
    }

    const raw = ctx.message.text.trim().replace(",", ".");
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) {
      await ctx.reply("Введи число, напр. 500 (мл) або 0.5 (л).");
      return;
    }

    // Heuristic: small numbers are liters, larger are millilitres.
    const ml = value < 20 ? Math.round(value * 1000) : Math.round(value);
    if (ml > 5000) {
      await ctx.reply("Забагато для одного запису. Введи реальний обсяг, напр. 500 мл.");
      return;
    }

    ctx.session.awaitingInput = null;
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    await addWater(user.id, ml);
    await showWater(ctx, `✅ Додано ${formatMl(ml)}.`);
  });
}
