import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../bot";
import { askConfirm } from "../confirm";
import { nutritionEntryKeyboard, nutritionListKeyboard } from "../keyboards";
import { findOrCreateUser } from "../../services/workout.service";
import {
  addNutritionEntry,
  copyNutritionEntries,
  deleteNutritionEntry,
  formatDisplayDate,
  getMacroTargets,
  getMacrosForDate,
  getNutritionEntries,
  getNutritionEntryById,
  localDateString,
  updateNutritionEntry,
} from "../../services/tracking.service";

function daysAgoDateString(n: number): string {
  const base = new Date(`${localDateString()}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - n);
  return localDateString(base);
}

// Returns a YYYY-MM-DD date if the token is a date specifier, otherwise null.
function resolveDateToken(token: string): string | null {
  const t = token.toLowerCase();
  if (t === "вчора") return daysAgoDateString(1);
  if (t === "позавчора") return daysAgoDateString(2);
  const rel = /^-(\d{1,2})$/.exec(t);
  if (rel) return daysAgoDateString(Number(rel[1]));
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return null;
}

function dayLabel(date: string): string {
  if (date === localDateString()) return "Сьогодні";
  return formatDisplayDate(new Date(`${date}T12:00:00Z`));
}

function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return localDateString(d);
}

function nutritionEntryLabel(e: {
  label: string | null;
  calories: number;
  proteinGrams: number;
}): string {
  const name = e.label ?? (e.calories > 0 ? "Їжа" : "Білок");
  if (e.calories > 0) {
    return `${name} · ${Math.round(e.calories)} ккал`;
  }
  return `${name} · ${Math.round(e.proteinGrams)} г білка`;
}

async function showDailyTotals(ctx: BotContext, userId: string, date = localDateString()) {
  const macros = await getMacrosForDate(userId, date);
  const targets = await getMacroTargets(userId);
  const calTarget = targets.calories;
  const proteinTarget = targets.protein;
  const calLeft = calTarget - macros.calories;
  const entries = await getNutritionEntries(userId, date);
  const keyboard =
    entries.length > 0 ? new InlineKeyboard().text("📋 Записи дня", `nl_list:${date}`) : undefined;

  await ctx.reply(
    `📊 <b>${dayLabel(date)} разом</b>\n` +
      `🔥 ${macros.calories} / ${calTarget} ккал ${calLeft >= 0 ? `(залишок ${calLeft})` : `(перебір ${-calLeft})`}\n` +
      `🥩 Білки: ${macros.protein} / ${proteinTarget} г\n` +
      `🧈 Жири: ${macros.fat} / ${targets.fat} г • 🍞 Вуглеводи: ${macros.carbs} / ${targets.carbs} г`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

async function showNutritionList(ctx: BotContext, date: string, edit = true) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const entries = await getNutritionEntries(user.id, date);

  const today = localDateString();
  const nav = { prev: shiftDate(date, -1), next: date < today ? shiftDate(date, 1) : null };
  const list = entries.map((e) => ({ id: e.id, label: nutritionEntryLabel(e) }));

  const text =
    entries.length > 0
      ? `📋 <b>${dayLabel(date)} — записи</b>\nОбери, щоб змінити або видалити. Гортай дні стрілками.`
      : `📋 <b>${dayLabel(date)}</b>\nЗаписів немає. Гортай дні стрілками нижче.`;
  const markup = nutritionListKeyboard(date, list, nav);

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: markup }).catch(() => undefined);
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: markup });
  }
}

async function showNutritionEntry(ctx: BotContext, id: string) {
  const e = await getNutritionEntryById(id);
  if (!e) {
    await ctx.answerCallbackQuery({ text: "Запис не знайдено" });
    return;
  }
  const text =
    `🍽 <b>${e.label ?? "Запис"}</b>\n` +
    `🔥 ${Math.round(e.calories)} ккал\n` +
    `🥩 ${Math.round(e.proteinGrams)} г • 🧈 ${Math.round(e.fatGrams)} г • 🍞 ${Math.round(e.carbsGrams)} г\n` +
    `📅 ${dayLabel(e.date)}`;
  await ctx
    .editMessageText(text, { parse_mode: "HTML", reply_markup: nutritionEntryKeyboard(id, e.date) })
    .catch(() => undefined);
}

export function registerFoodHandlers(bot: Bot<BotContext>) {
  bot.command("food", async (ctx) => {
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    await showDailyTotals(ctx, user.id);

    const keyboard = new InlineKeyboard()
      .text("✍️ Ввести вручну", "food_manual")
      .text("↺ Як учора", "food_yday")
      .row()
      .text("📋 Записи по днях", `nl_list:${localDateString()}`);
    await ctx.reply("🍽 Додай КБЖВ вручну або переглянь записи:", { reply_markup: keyboard });
  });

  bot.callbackQuery("food_yday", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const entries = await getNutritionEntries(user.id, daysAgoDateString(1));
    if (entries.length === 0) {
      await ctx.reply("Учора записів їжі немає.");
      return;
    }

    const total = Math.round(entries.reduce((sum, e) => sum + e.calories, 0));
    const keyboard = new InlineKeyboard();
    for (const e of entries.slice(0, 15)) {
      keyboard.text(`+ ${nutritionEntryLabel(e)}`, `fy:${e.id}`).row();
    }
    keyboard.text(`✅ Додати все (${total} ккал)`, "fy_all");

    await ctx.reply("↺ <b>Учора</b> — обери, що додати на сьогодні:", {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^fy:(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const copied = await copyNutritionEntries(user.id, [ctx.match![1]], localDateString());
    await ctx.answerCallbackQuery({ text: copied ? "Додано" : "Запис не знайдено" });
    if (copied) await showDailyTotals(ctx, user.id);
  });

  bot.callbackQuery("fy_all", async (ctx) => {
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const entries = await getNutritionEntries(user.id, daysAgoDateString(1));
    const copied = await copyNutritionEntries(user.id, entries.map((e) => e.id), localDateString());
    await ctx.answerCallbackQuery({ text: `Додано ${copied}` });
    await ctx.deleteMessage().catch(() => undefined);
    await showDailyTotals(ctx, user.id);
  });

  bot.callbackQuery("food_manual", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.awaitingInput = "food_macros";
    await ctx.reply(
      "Введи КБЖВ через пробіл: <code>ккал білки жири вуглеводи [назва]</code>\n" +
        "Наприклад: <code>250 6 12 30 печиво</code>\n\n" +
        "Щоб додати за минулий день — почни з дати:\n" +
        "<code>вчора 250 6 12 30 печиво</code>\n" +
        "<code>-2 600 40 20 50</code> (2 дні тому)\n" +
        "<code>2026-05-29 600 40 20 50</code>",
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery(/^nl_list:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showNutritionList(ctx, ctx.match![1], true);
  });

  bot.callbackQuery(/^nl:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showNutritionEntry(ctx, ctx.match![1]);
  });

  bot.callbackQuery(/^nl_edit:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match![1];
    const e = await getNutritionEntryById(id);
    if (!e) {
      await ctx.reply("Запис не знайдено.");
      return;
    }
    ctx.session.awaitingInput = "food_edit";
    ctx.session.editEntryId = id;
    await ctx.reply(
      `Введи нові КБЖВ для «${e.label ?? "запис"}» через пробіл:\n` +
        "<code>ккал білки жири вуглеводи [назва]</code>\n" +
        `Зараз: <code>${Math.round(e.calories)} ${Math.round(e.proteinGrams)} ${Math.round(e.fatGrams)} ${Math.round(e.carbsGrams)}</code>`,
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery(/^nl_del:(.+)$/, async (ctx) => {
    const id = ctx.match![1];
    const e = await getNutritionEntryById(id);
    const label = e ? nutritionEntryLabel(e) : "запис";
    await askConfirm(ctx, `🗑 <b>Видалити запис КБЖВ</b>\n${label}?`, `nl_del:${id}`);
  });

  bot.callbackQuery(/^cfm:nl_del:(.+)$/, async (ctx) => {
    const id = ctx.match![1];
    const e = await getNutritionEntryById(id);
    const date = e?.date ?? localDateString();
    await deleteNutritionEntry(id).catch(() => undefined);
    await ctx.answerCallbackQuery({ text: "Видалено" });
    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }
    await showNutritionList(ctx, date, true);
  });

  bot.on("message:text", async (ctx, next) => {
    const mode = ctx.session.awaitingInput;
    if (mode !== "food_macros" && mode !== "food_edit") {
      return next();
    }

    let tokens = ctx.message.text.trim().split(/\s+/);

    let date = localDateString();
    if (mode === "food_macros") {
      const maybeDate = resolveDateToken(tokens[0]);
      if (maybeDate) {
        date = maybeDate;
        tokens = tokens.slice(1);
      }
    }

    const nums = tokens.slice(0, 4).map((x) => Number(x.replace(",", ".")));
    if (nums.length < 4 || nums.some((n) => !Number.isFinite(n) || n < 0)) {
      await ctx.reply(
        "Формат: <code>[дата] ккал білки жири вуглеводи [назва]</code>\n" +
          "Напр.: <code>650 45 20 60 перекус</code> або <code>вчора 650 45 20 60</code>",
        { parse_mode: "HTML" },
      );
      return;
    }

    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const [calories, protein, fat, carbs] = nums;
    const labelFromText = tokens.slice(4).join(" ").trim();

    if (mode === "food_edit") {
      const id = ctx.session.editEntryId;
      ctx.session.awaitingInput = null;
      ctx.session.editEntryId = null;
      if (!id) {
        return;
      }
      const existing = await getNutritionEntryById(id);
      const label = labelFromText || existing?.label || "Їжа";
      await updateNutritionEntry(id, { calories, protein, fat, carbs, label });
      const entryDate = existing?.date ?? date;
      await ctx.reply(`✅ Оновлено: ${Math.round(calories)} ккал.`);
      await showDailyTotals(ctx, user.id, entryDate);
      return;
    }

    const label = labelFromText || "Їжа (вручну)";

    await addNutritionEntry(user.id, { calories, protein, fat, carbs, label }, date);
    ctx.session.awaitingInput = null;

    await ctx.reply(`✅ Записано (${dayLabel(date)}): ${Math.round(calories)} ккал.`);
    await showDailyTotals(ctx, user.id, date);
  });
}
