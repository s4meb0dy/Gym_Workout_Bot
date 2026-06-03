import { Bot, InlineKeyboard } from "grammy";
import { BotContext, PendingFood } from "../bot";
import { foodConfirmKeyboard, nutritionEntryKeyboard, nutritionListKeyboard } from "../keyboards";
import { config } from "../../config/env";
import { analyzeFoodPhoto, isFoodVisionEnabled } from "../../services/food-vision";
import { findOrCreateUser } from "../../services/workout.service";
import {
  addNutritionEntry,
  deleteNutritionEntry,
  formatDisplayDate,
  getCalorieTarget,
  getMacrosForDate,
  getNutritionEntries,
  getNutritionEntryById,
  getProteinTarget,
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

function formatEstimate(food: PendingFood, confidence?: string): string {
  let text =
    `🍽 <b>${food.label}</b>\n\n` +
    `🔥 Калорії: <b>${food.calories} ккал</b>\n` +
    `🥩 Білки: <b>${food.protein} г</b>\n` +
    `🧈 Жири: <b>${food.fat} г</b>\n` +
    `🍞 Вуглеводи: <b>${food.carbs} г</b>`;
  if (confidence) {
    const map: Record<string, string> = {
      low: "низька (уточни грами)",
      medium: "середня",
      high: "висока",
    };
    text += `\n\n<i>Точність оцінки: ${map[confidence] ?? confidence}</i>`;
  }
  return text;
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
  const calTarget = await getCalorieTarget(userId);
  const proteinTarget = await getProteinTarget(userId);
  const calLeft = calTarget - macros.calories;
  const entries = await getNutritionEntries(userId, date);
  const keyboard =
    entries.length > 0 ? new InlineKeyboard().text("📋 Записи дня", `nl_list:${date}`) : undefined;

  await ctx.reply(
    `📊 <b>${dayLabel(date)} разом</b>\n` +
      `🔥 ${macros.calories} / ${calTarget} ккал ${calLeft >= 0 ? `(залишок ${calLeft})` : `(перебір ${-calLeft})`}\n` +
      `🥩 Білки: ${macros.protein} / ${proteinTarget} г\n` +
      `🧈 Жири: ${macros.fat} г • 🍞 Вуглеводи: ${macros.carbs} г`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

async function showNutritionList(ctx: BotContext, date: string, edit = true) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const entries = await getNutritionEntries(user.id, date);
  if (entries.length === 0) {
    const text = `📋 ${dayLabel(date)}: записів немає.`;
    if (edit) {
      await ctx.editMessageText(text).catch(() => undefined);
    } else {
      await ctx.reply(text);
    }
    return;
  }
  const list = entries.map((e) => ({ id: e.id, label: nutritionEntryLabel(e) }));
  const text = `📋 <b>${dayLabel(date)} — записи</b>\nОбери, щоб змінити або видалити:`;
  const markup = nutritionListKeyboard(date, list);
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

    const keyboard = new InlineKeyboard().text("✍️ Ввести вручну", "food_manual");
    if (isFoodVisionEnabled()) {
      await ctx.reply(
        "Надішли фото страви (можна з підписом, напр. «~250 г курки з рисом») — і я порахую КБЖВ.\n\nАбо введи цифри вручну для перекусу:",
        { reply_markup: keyboard },
      );
    } else {
      await ctx.reply(
        "🍽 Розпізнавання по фото вимкнено (немає GEMINI_API_KEY). Але можеш ввести КБЖВ вручну:",
        { reply_markup: keyboard },
      );
    }
  });

  bot.on("message:photo", async (ctx) => {
    if (!ctx.from) return;

    if (!isFoodVisionEnabled()) {
      await ctx.reply(
        "🍽 Щоб рахувати КБЖВ по фото, додай GEMINI_API_KEY у .env на сервері та перезапусти бота.",
      );
      return;
    }

    const thinking = await ctx.reply("🔍 Аналізую фото...");

    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const file = await ctx.api.getFile(largest.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;

      const res = await fetch(fileUrl);
      const buffer = Buffer.from(await res.arrayBuffer());
      const base64 = buffer.toString("base64");

      const estimate = await analyzeFoodPhoto(base64, "image/jpeg", ctx.message.caption);

      if (!estimate.isFood) {
        await ctx.api
          .editMessageText(thinking.chat.id, thinking.message_id, "🤔 Не схоже на їжу. Надішли фото страви.")
          .catch(() => undefined);
        return;
      }

      const pending: PendingFood = {
        calories: estimate.calories,
        protein: estimate.protein,
        fat: estimate.fat,
        carbs: estimate.carbs,
        label: estimate.dish,
      };
      ctx.session.pendingFood = pending;

      await ctx.api
        .deleteMessage(thinking.chat.id, thinking.message_id)
        .catch(() => undefined);

      await ctx.reply(formatEstimate(pending, estimate.confidence), {
        parse_mode: "HTML",
        reply_markup: foodConfirmKeyboard(),
      });
    } catch (error) {
      console.error("Food analysis failed:", error);
      await ctx.api
        .editMessageText(
          thinking.chat.id,
          thinking.message_id,
          "⚠️ Не вдалося розпізнати фото. Спробуй ще раз або введи КБЖВ вручну командою /food.",
        )
        .catch(() => undefined);
    }
  });

  bot.callbackQuery("food_log", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const pending = ctx.session.pendingFood;
    if (!pending) {
      await ctx.reply("Немає що записувати — надішли фото страви.");
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    await addNutritionEntry(user.id, {
      calories: pending.calories,
      protein: pending.protein,
      fat: pending.fat,
      carbs: pending.carbs,
      label: pending.label,
    });
    ctx.session.pendingFood = null;

    await ctx.reply(`✅ Записано: ${pending.label} (${pending.calories} ккал).`);
    await showDailyTotals(ctx, user.id);
  });

  bot.callbackQuery("food_edit", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.awaitingInput = "food_macros";
    await ctx.reply(
      "Введи КБЖВ через пробіл: <code>ккал білки жири вуглеводи</code>\nНаприклад: <code>650 45 20 60</code>",
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery("food_manual", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.pendingFood = null;
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

  bot.callbackQuery("food_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Скасовано" });
    ctx.session.pendingFood = null;
    ctx.session.awaitingInput = null;
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
    const date = e?.date ?? localDateString();
    await deleteNutritionEntry(id).catch(() => undefined);
    await ctx.answerCallbackQuery({ text: "Видалено" });
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

    const label = labelFromText || ctx.session.pendingFood?.label || "Їжа (вручну)";

    await addNutritionEntry(user.id, { calories, protein, fat, carbs, label }, date);
    ctx.session.awaitingInput = null;
    ctx.session.pendingFood = null;

    await ctx.reply(`✅ Записано (${dayLabel(date)}): ${Math.round(calories)} ккал.`);
    await showDailyTotals(ctx, user.id, date);
  });
}
