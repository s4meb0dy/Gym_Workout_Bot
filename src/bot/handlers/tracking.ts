import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../bot";
import {
  backToMenuKeyboard,
  bodyWeightEntryKeyboard,
  bodyWeightListKeyboard,
  reminderSettingsKeyboard,
  toolsKeyboard,
} from "../keyboards";
import { buildLineChartUrl } from "../../services/chart.service";
import { findOrCreateUser } from "../../services/workout.service";
import {
  addProtein,
  deleteBodyWeight,
  formatDisplayDate,
  getBodyWeightById,
  getBodyWeights,
  getLatestBodyWeight,
  getProteinForDate,
  getProteinHistory,
  getProteinTarget,
  getReminderSetting,
  logBodyWeight,
  movingAverage,
  resetProteinForDate,
  updateBodyWeight,
  upsertReminderSetting,
} from "../../services/tracking.service";

function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  const value = parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

async function showBodyWeight(ctx: BotContext, value?: number) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);

  if (value === undefined) {
    const latest = await getLatestBodyWeight(user.id);
    const hint = latest
      ? `Остання вага: <b>${latest.weightKg} кг</b> (${formatDisplayDate(latest.recordedAt)}).`
      : "Записів ще немає.";
    ctx.session.awaitingInput = "weight";
    const keyboard = latest
      ? new InlineKeyboard().text("📝 Редагувати записи", "bw_list")
      : undefined;
    await ctx.reply(`⚖️ <b>Вага тіла</b>\n${hint}\n\nВведи поточну вагу, напр. <code>74.8</code>`, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    return;
  }

  if (value < 30 || value > 300) {
    await ctx.reply("Це не схоже на вагу тіла. Введи число в кг, напр. 74.8");
    return;
  }

  await logBodyWeight(user.id, value);
  ctx.session.awaitingInput = null;

  const weights = await getBodyWeights(user.id, 60);
  if (weights.length < 2) {
    await ctx.reply(`✅ Записано вагу: <b>${value} кг</b>. Графік зʼявиться після кількох записів.`, {
      parse_mode: "HTML",
    });
    return;
  }

  const labels = weights.map((w) => formatDisplayDate(w.recordedAt));
  const values = weights.map((w) => w.weightKg);
  const avg = movingAverage(values, 7).map((v) => Math.round(v * 10) / 10);
  const chartUrl = buildLineChartUrl("Вага тіла, кг", labels, [
    { label: "Вага", data: values, color: "#3b82f6" },
    { label: "Середнє (7)", data: avg, color: "#ef4444", dashed: true },
  ]);

  const first = values[0];
  const last = values[values.length - 1];
  const diff = Math.round((last - first) * 10) / 10;
  const trend = diff === 0 ? "без змін" : diff > 0 ? `+${diff} кг` : `${diff} кг`;

  await ctx.replyWithPhoto(chartUrl, {
    caption: `✅ Записано: <b>${value} кг</b>\nДинаміка за період: <b>${trend}</b>`,
    parse_mode: "HTML",
  });
}

async function showWeightList(ctx: BotContext, edit = false) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const weights = await getBodyWeights(user.id, 12);
  if (weights.length === 0) {
    const text = "⚖️ Записів ваги ще немає.";
    if (edit) {
      await ctx.editMessageText(text).catch(() => undefined);
    } else {
      await ctx.reply(text);
    }
    return;
  }

  const entries = [...weights]
    .reverse()
    .map((w) => ({ id: w.id, label: `${formatDisplayDate(w.recordedAt)} — ${w.weightKg} кг` }));
  const text = "⚖️ <b>Записи ваги</b>\nОбери запис, щоб змінити або видалити:";
  const markup = bodyWeightListKeyboard(entries);
  if (edit) {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: markup }).catch(() => undefined);
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: markup });
  }
}

async function showWeightEntry(ctx: BotContext, id: string) {
  const w = await getBodyWeightById(id);
  if (!w) {
    await ctx.answerCallbackQuery({ text: "Запис не знайдено" });
    await showWeightList(ctx, true);
    return;
  }
  const text = `⚖️ <b>${w.weightKg} кг</b>\n📅 ${formatDisplayDate(w.recordedAt)}`;
  await ctx
    .editMessageText(text, { parse_mode: "HTML", reply_markup: bodyWeightEntryKeyboard(id) })
    .catch(() => undefined);
}

async function showProtein(ctx: BotContext, value?: number) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const target = await getProteinTarget(user.id);

  if (value === undefined) {
    const total = await getProteinForDate(user.id);
    ctx.session.awaitingInput = "protein";
    await ctx.reply(
      `🍗 <b>Білок сьогодні</b>: ${Math.round(total)} / ${target} г\n\n` +
        "Введи, скільки грамів білка додати (напр. <code>40</code>).\n" +
        "Команда <code>/protein reset</code> — обнулити день.",
      { parse_mode: "HTML" },
    );
    return;
  }

  if (value > 500) {
    await ctx.reply("Забагато для одного запису. Введи грами білка, напр. 40");
    return;
  }

  await addProtein(user.id, value);
  ctx.session.awaitingInput = null;

  const total = await getProteinForDate(user.id);
  const left = Math.max(0, target - total);
  const status =
    total >= target
      ? `🎉 Ціль ${target} г досягнута! (${Math.round(total)} г)`
      : `Залишилось ще <b>${Math.round(left)} г</b> до цілі ${target} г.`;

  await ctx.reply(`✅ Додано ${value} г. Разом сьогодні: <b>${Math.round(total)} г</b>.\n${status}`, {
    parse_mode: "HTML",
  });
}

async function showReminders(ctx: BotContext) {
  if (!ctx.from || !ctx.chat) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  let setting = await getReminderSetting(user.id);
  if (!setting) {
    setting = await upsertReminderSetting(user.id, ctx.chat.id);
  }

  await ctx.reply(
    "🔔 <b>Нагадування</b>\nНалаштуй, що і коли надсилати. Натискай, щоб увімкнути/вимкнути.",
    { parse_mode: "HTML", reply_markup: reminderSettingsKeyboard(setting) },
  );
}

export function registerTrackingHandlers(bot: Bot<BotContext>) {
  bot.command("weight", async (ctx) => {
    const arg = ctx.match?.trim();
    const value = arg ? parseNumber(arg) : undefined;
    if (arg && value === null) {
      await ctx.reply("Введи число, напр. /weight 74.8");
      return;
    }
    await showBodyWeight(ctx, value ?? undefined);
  });

  bot.command("protein", async (ctx) => {
    const arg = ctx.match?.trim();
    if (arg && arg.toLowerCase() === "reset") {
      if (ctx.from) {
        const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
        await resetProteinForDate(user.id);
      }
      ctx.session.awaitingInput = null;
      await ctx.reply("Лічильник білка за сьогодні обнулено.");
      return;
    }
    const value = arg ? parseNumber(arg) : undefined;
    if (arg && value === null) {
      await ctx.reply("Введи число, напр. /protein 40");
      return;
    }
    await showProtein(ctx, value ?? undefined);
  });

  bot.command("reminders", (ctx) => showReminders(ctx));

  bot.hears("⚖️ Вага тіла", (ctx) => showBodyWeight(ctx));
  bot.hears("🍗 Білок", (ctx) => showProtein(ctx));
  bot.hears("🛠 Інструменти", async (ctx) => {
    await ctx.reply("🛠 <b>Інструменти</b>", {
      parse_mode: "HTML",
      reply_markup: toolsKeyboard(),
    });
  });

  bot.callbackQuery("tools_reminders", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showReminders(ctx);
  });

  bot.callbackQuery("rem_noop", (ctx) => ctx.answerCallbackQuery());

  const reminderToggle = async (
    ctx: BotContext,
    field:
      | "workoutEnabled"
      | "proteinEnabled"
      | "backupEnabled"
      | "digestEnabled"
      | "supplementsEnabled"
      | "waterEnabled",
  ) => {
    if (!ctx.from || !ctx.chat) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const current = await getReminderSetting(user.id);
    const updated = await upsertReminderSetting(user.id, ctx.chat.id, {
      [field]: !(current?.[field] ?? true),
    });
    await ctx.answerCallbackQuery({ text: "Збережено" });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: reminderSettingsKeyboard(updated) });
    } catch {
      // ignore
    }
  };

  bot.callbackQuery("rem_toggle_workout", (ctx) => reminderToggle(ctx, "workoutEnabled"));
  bot.callbackQuery("rem_toggle_protein", (ctx) => reminderToggle(ctx, "proteinEnabled"));
  bot.callbackQuery("rem_toggle_backup", (ctx) => reminderToggle(ctx, "backupEnabled"));
  bot.callbackQuery("rem_toggle_digest", (ctx) => reminderToggle(ctx, "digestEnabled"));
  bot.callbackQuery("rem_toggle_supplements", (ctx) => reminderToggle(ctx, "supplementsEnabled"));
  bot.callbackQuery("rem_toggle_water", (ctx) => reminderToggle(ctx, "waterEnabled"));

  const adjustProteinTarget = async (ctx: BotContext, delta: number) => {
    if (!ctx.from || !ctx.chat) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const current = await getReminderSetting(user.id);
    const target = Math.max(50, Math.min(400, (current?.proteinTarget ?? 150) + delta));
    const updated = await upsertReminderSetting(user.id, ctx.chat.id, { proteinTarget: target });
    await ctx.answerCallbackQuery({ text: `Ціль: ${target} г` });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: reminderSettingsKeyboard(updated) });
    } catch {
      // ignore
    }
  };

  bot.callbackQuery("rem_protein_minus", (ctx) => adjustProteinTarget(ctx, -10));
  bot.callbackQuery("rem_protein_plus", (ctx) => adjustProteinTarget(ctx, 10));

  const adjustWaterTarget = async (ctx: BotContext, delta: number) => {
    if (!ctx.from || !ctx.chat) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const current = await getReminderSetting(user.id);
    const target = Math.max(1000, Math.min(6000, (current?.waterTargetMl ?? 3000) + delta));
    const updated = await upsertReminderSetting(user.id, ctx.chat.id, { waterTargetMl: target });
    await ctx.answerCallbackQuery({ text: `Ціль води: ${(target / 1000).toFixed(target % 1000 === 0 ? 0 : 1)} л` });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: reminderSettingsKeyboard(updated) });
    } catch {
      // ignore
    }
  };

  bot.callbackQuery("rem_water_minus", (ctx) => adjustWaterTarget(ctx, -250));
  bot.callbackQuery("rem_water_plus", (ctx) => adjustWaterTarget(ctx, 250));

  bot.command("proteinhistory", async (ctx) => {
    if (!ctx.from) return;
    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const history = await getProteinHistory(user.id, 14);
    if (history.length === 0) {
      await ctx.reply("Записів білка ще немає.", { reply_markup: backToMenuKeyboard() });
      return;
    }
    let text = "🍗 <b>Білок за останні дні</b>\n\n";
    for (const day of history) {
      text += `${day.date}: ${Math.round(day.total)} г\n`;
    }
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: backToMenuKeyboard() });
  });

  bot.callbackQuery("bw_list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showWeightList(ctx, true);
  });

  bot.callbackQuery(/^bw:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showWeightEntry(ctx, ctx.match![1]);
  });

  bot.callbackQuery(/^bw_edit:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match![1];
    const w = await getBodyWeightById(id);
    if (!w) {
      await showWeightList(ctx, true);
      return;
    }
    ctx.session.awaitingInput = "weight_edit";
    ctx.session.editEntryId = id;
    await ctx.reply(`Введи нову вагу для запису ${formatDisplayDate(w.recordedAt)} (зараз ${w.weightKg} кг):`);
  });

  bot.callbackQuery(/^bw_del:(.+)$/, async (ctx) => {
    const id = ctx.match![1];
    await deleteBodyWeight(id).catch(() => undefined);
    await ctx.answerCallbackQuery({ text: "Видалено" });
    await showWeightList(ctx, true);
  });

  // Routed text input for weight/protein quick entry.
  bot.on("message:text", async (ctx, next) => {
    const mode = ctx.session.awaitingInput;
    if (mode !== "weight" && mode !== "protein" && mode !== "weight_edit") {
      return next();
    }

    const menuButtons = [
      "🏋️ Розпочати тренування",
      "📋 Моя програма (4 дні)",
      "📊 Статистика та рекорди",
      "⚖️ Вага тіла",
      "🍗 Білок",
      "💧 Вода",
      "🛠 Інструменти",
    ];
    if (menuButtons.includes(ctx.message.text)) {
      ctx.session.awaitingInput = null;
      return next();
    }

    const value = parseNumber(ctx.message.text);
    if (value === null) {
      await ctx.reply("Введи число, напр. 74.8");
      return;
    }

    if (mode === "weight") {
      await showBodyWeight(ctx, value);
    } else if (mode === "weight_edit") {
      if (value < 30 || value > 300) {
        await ctx.reply("Це не схоже на вагу тіла. Введи число в кг, напр. 74.8");
        return;
      }
      const id = ctx.session.editEntryId;
      ctx.session.awaitingInput = null;
      ctx.session.editEntryId = null;
      if (id) {
        await updateBodyWeight(id, value).catch(() => undefined);
      }
      await ctx.reply(`✅ Оновлено вагу: <b>${value} кг</b>.`, { parse_mode: "HTML" });
      await showWeightList(ctx);
    } else if (mode === "protein") {
      await showProtein(ctx, value);
    }
  });
}
