import { Bot, InputFile } from "grammy";
import { BotContext } from "../bot";
import { backupExists, buildBackupFile } from "../../services/backup.service";
import { getAllSetsForExport } from "../../services/analytics.service";
import { buildSetsCsv } from "../../services/export.service";
import { findOrCreateUser } from "../../services/workout.service";

async function sendBackup(ctx: BotContext) {
  if (!ctx.chat) return;

  if (!backupExists()) {
    await ctx.reply("Файл бази даних не знайдено на сервері.");
    return;
  }

  await ctx.replyWithDocument(buildBackupFile(), {
    caption:
      "💾 Бекап бази даних. Збережи цей файл — на безкоштовному хостингу диск може очищатися при перезапуску.",
  });
}

async function sendExport(ctx: BotContext) {
  if (!ctx.from) return;
  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const rows = await getAllSetsForExport(user.id);

  if (rows.length === 0) {
    await ctx.reply("Немає завершених тренувань для експорту.");
    return;
  }

  const csv = buildSetsCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new InputFile(Buffer.from(csv, "utf-8"), `gymapp-history-${stamp}.csv`);

  await ctx.replyWithDocument(file, {
    caption: `📤 Експорт історії: ${rows.length} підходів.`,
  });
}

export function registerToolsHandlers(bot: Bot<BotContext>) {
  bot.command("backup", (ctx) => sendBackup(ctx));
  bot.command("export", (ctx) => sendExport(ctx));

  bot.callbackQuery("tools_backup", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Готую бекап..." });
    await sendBackup(ctx);
  });

  bot.callbackQuery("tools_export", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Готую CSV..." });
    await sendExport(ctx);
  });
}
