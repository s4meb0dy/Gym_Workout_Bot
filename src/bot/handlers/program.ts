import { Bot } from "grammy";
import { BotContext } from "../bot";
import { backToMenuKeyboard } from "../keyboards";
import { formatExerciseTarget, formatProgressionLabel, formatRestDuration } from "../../services/progression";
import { getWorkoutDayByNumber, getWorkoutDays } from "../../services/workout.service";

function formatBaseline(exercise: {
  baselineNote: string | null;
  baselineWeightMin: number | null;
  baselineWeightMax: number | null;
}): string {
  if (exercise.baselineNote) {
    return `Орієнтир: ${exercise.baselineNote}`;
  }
  return "";
}

export function registerProgramHandlers(bot: Bot<BotContext>) {
  bot.command("program", async (ctx) => {
    const { programDayKeyboard } = await import("../keyboards");
    const days = await getWorkoutDays();
    await ctx.reply("Обери день, щоб переглянути програму:", {
      reply_markup: programDayKeyboard(days),
    });
  });

  bot.callbackQuery(/^program_day:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const dayNumber = Number(ctx.match![1]);
    const day = await getWorkoutDayByNumber(dayNumber);

    if (!day) {
      await ctx.reply("День не знайдено.");
      return;
    }

    let text = `<b>${day.weekday}: ${day.name}</b>\n\n`;
    let currentBlock = "";

    for (const exercise of day.exercises) {
      if (exercise.block !== currentBlock) {
        currentBlock = exercise.block;
        text += `\n<b>▸ ${currentBlock}</b>\n`;
      }

      const repTarget = formatExerciseTarget(
        exercise.targetRepsMin,
        exercise.targetRepsMax,
        exercise.exerciseType as "reps" | "time" | "warmup",
      );

      text += `${exercise.orderIndex}. ${exercise.name}\n`;
      text += `   ${exercise.targetSets}×${repTarget}\n`;
      text += `   Відпочинок: ${formatRestDuration(exercise.restTimeInSeconds)}\n`;

      if (exercise.exerciseType === "warmup") {
        text += `   Підтвердження кнопкою (без ваги)\n`;
      } else {
        const baseline = formatBaseline(exercise);
        if (baseline) {
          text += `   ${baseline}\n`;
        }
        text += `   ${formatProgressionLabel(exercise.progressionMode, exercise.progressionStep)}\n`;
      }
    }

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: backToMenuKeyboard(),
    });
  });
}
