import { Bot, InlineKeyboard } from "grammy";
import { BotContext, PendingFood } from "../bot";
import { foodConfirmKeyboard } from "../keyboards";
import { config } from "../../config/env";
import { analyzeFoodPhoto, isFoodVisionEnabled } from "../../services/food-vision";
import { findOrCreateUser } from "../../services/workout.service";
import {
  addNutritionEntry,
  getCalorieTarget,
  getMacrosForDate,
  getProteinTarget,
} from "../../services/tracking.service";

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

async function showDailyTotals(ctx: BotContext, userId: string) {
  const macros = await getMacrosForDate(userId);
  const calTarget = await getCalorieTarget(userId);
  const proteinTarget = await getProteinTarget(userId);
  const calLeft = calTarget - macros.calories;

  await ctx.reply(
    `📊 <b>Сьогодні разом</b>\n` +
      `🔥 ${macros.calories} / ${calTarget} ккал ${calLeft >= 0 ? `(залишок ${calLeft})` : `(перебір ${-calLeft})`}\n` +
      `🥩 Білки: ${macros.protein} / ${proteinTarget} г\n` +
      `🧈 Жири: ${macros.fat} г • 🍞 Вуглеводи: ${macros.carbs} г`,
    { parse_mode: "HTML" },
  );
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
        "Наприклад: <code>250 6 12 30 печиво</code>\n" +
        "Назва — необов'язкова.",
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery("food_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Скасовано" });
    ctx.session.pendingFood = null;
    ctx.session.awaitingInput = null;
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.session.awaitingInput !== "food_macros") {
      return next();
    }

    const tokens = ctx.message.text.trim().split(/\s+/);
    const nums = tokens.slice(0, 4).map((x) => Number(x.replace(",", ".")));
    if (nums.length < 4 || nums.some((n) => !Number.isFinite(n) || n < 0)) {
      await ctx.reply(
        "Формат: <code>ккал білки жири вуглеводи [назва]</code>, напр. <code>650 45 20 60 перекус</code>",
        { parse_mode: "HTML" },
      );
      return;
    }

    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const [calories, protein, fat, carbs] = nums;
    const labelFromText = tokens.slice(4).join(" ").trim();
    const label = labelFromText || ctx.session.pendingFood?.label || "Їжа (вручну)";

    await addNutritionEntry(user.id, { calories, protein, fat, carbs, label });
    ctx.session.awaitingInput = null;
    ctx.session.pendingFood = null;

    await ctx.reply(`✅ Записано: ${Math.round(calories)} ккал.`);
    await showDailyTotals(ctx, user.id);
  });
}
