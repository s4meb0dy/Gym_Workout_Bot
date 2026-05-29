import { Bot } from "grammy";
import { BotContext } from "../bot";
import {
  editExerciseKeyboard,
  editProgramDayKeyboard,
  editProgramExerciseListKeyboard,
} from "../keyboards";
import { formatExerciseTarget, formatRestDuration } from "../../services/progression";
import {
  addExerciseToDay,
  deleteExercise,
  exerciseHasHistory,
  getExerciseById,
  getWorkoutDayByNumber,
  getWorkoutDayById,
  getWorkoutDays,
  renameExercise,
  updateExerciseTargets,
} from "../../services/workout.service";

const MENU_BUTTONS = [
  "🏋️ Розпочати тренування",
  "📋 Моя програма (4 дні)",
  "📊 Статистика та рекорди",
  "⚖️ Вага тіла",
  "🍗 Білок",
  "🛠 Інструменти",
];

async function showDayPicker(ctx: BotContext) {
  const days = await getWorkoutDays();
  await ctx.reply("✏️ <b>Редагування програми</b>\nОбери день:", {
    parse_mode: "HTML",
    reply_markup: editProgramDayKeyboard(days),
  });
}

async function showExerciseList(ctx: BotContext, dayNumber: number) {
  const day = await getWorkoutDayByNumber(dayNumber);
  if (!day) {
    await ctx.reply("День не знайдено.");
    return;
  }
  await ctx.reply(`✏️ <b>${day.weekday} — ${day.name}</b>\nОбери вправу або додай нову:`, {
    parse_mode: "HTML",
    reply_markup: editProgramExerciseListKeyboard(
      dayNumber,
      day.exercises.map((e) => ({ id: e.id, name: e.name })),
    ),
  });
}

async function showExerciseEditor(ctx: BotContext, exerciseId: number) {
  const exercise = await getExerciseById(exerciseId);
  if (!exercise) {
    await ctx.reply("Вправу не знайдено.");
    return;
  }
  const day = await getWorkoutDayById(exercise.workoutDayId);
  const hasHistory = await exerciseHasHistory(exerciseId);

  const repTarget = formatExerciseTarget(
    exercise.targetRepsMin,
    exercise.targetRepsMax,
    exercise.exerciseType as "reps" | "time" | "warmup",
  );

  const text =
    `✏️ <b>${exercise.name}</b>\n` +
    `Підходи × повтори: ${exercise.targetSets} × ${repTarget}\n` +
    `Відпочинок: ${formatRestDuration(exercise.restTimeInSeconds)}\n` +
    (hasHistory ? "\n<i>Має історію — видалення недоступне.</i>" : "");

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: editExerciseKeyboard({
      id: exercise.id,
      targetSets: exercise.targetSets,
      targetRepsMin: exercise.targetRepsMin,
      targetRepsMax: exercise.targetRepsMax,
      workoutDayId: exercise.workoutDayId,
      dayNumber: day?.dayNumber ?? 1,
      hasHistory,
    }),
  });
}

async function refreshExerciseEditor(ctx: BotContext, exerciseId: number) {
  const exercise = await getExerciseById(exerciseId);
  if (!exercise) return;
  const day = await getWorkoutDayById(exercise.workoutDayId);
  const hasHistory = await exerciseHasHistory(exerciseId);

  try {
    await ctx.editMessageReplyMarkup({
      reply_markup: editExerciseKeyboard({
        id: exercise.id,
        targetSets: exercise.targetSets,
        targetRepsMin: exercise.targetRepsMin,
        targetRepsMax: exercise.targetRepsMax,
        workoutDayId: exercise.workoutDayId,
        dayNumber: day?.dayNumber ?? 1,
        hasHistory,
      }),
    });
  } catch {
    // ignore "message not modified"
  }
}

export function registerEditProgramHandlers(bot: Bot<BotContext>) {
  bot.command("editprogram", (ctx) => showDayPicker(ctx));

  bot.callbackQuery("tools_editprogram", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showDayPicker(ctx);
  });

  bot.callbackQuery(/^ep_day:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showExerciseList(ctx, Number(ctx.match![1]));
  });

  bot.callbackQuery(/^ep_ex:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showExerciseEditor(ctx, Number(ctx.match![1]));
  });

  bot.callbackQuery("ep_noop", (ctx) => ctx.answerCallbackQuery());

  const stepHandlers: Array<{
    pattern: RegExp;
    field: "targetSets" | "targetRepsMin" | "targetRepsMax";
    delta: number;
    min: number;
    max: number;
  }> = [
    { pattern: /^ep_sets_inc:(\d+)$/, field: "targetSets", delta: 1, min: 1, max: 10 },
    { pattern: /^ep_sets_dec:(\d+)$/, field: "targetSets", delta: -1, min: 1, max: 10 },
    { pattern: /^ep_repmin_inc:(\d+)$/, field: "targetRepsMin", delta: 1, min: 1, max: 100 },
    { pattern: /^ep_repmin_dec:(\d+)$/, field: "targetRepsMin", delta: -1, min: 1, max: 100 },
    { pattern: /^ep_repmax_inc:(\d+)$/, field: "targetRepsMax", delta: 1, min: 1, max: 100 },
    { pattern: /^ep_repmax_dec:(\d+)$/, field: "targetRepsMax", delta: -1, min: 1, max: 100 },
  ];

  for (const handler of stepHandlers) {
    bot.callbackQuery(handler.pattern, async (ctx) => {
      const exerciseId = Number(ctx.match![1]);
      const exercise = await getExerciseById(exerciseId);
      if (!exercise) {
        await ctx.answerCallbackQuery({ text: "Вправу не знайдено" });
        return;
      }

      let value = exercise[handler.field] + handler.delta;
      value = Math.max(handler.min, Math.min(handler.max, value));

      // Тримаємо min ≤ max.
      const data: Record<string, number> = { [handler.field]: value };
      if (handler.field === "targetRepsMin" && value > exercise.targetRepsMax) {
        data.targetRepsMax = value;
      }
      if (handler.field === "targetRepsMax" && value < exercise.targetRepsMin) {
        data.targetRepsMin = value;
      }

      await updateExerciseTargets(exerciseId, data);
      await ctx.answerCallbackQuery({ text: "Збережено" });
      await refreshExerciseEditor(ctx, exerciseId);
    });
  }

  bot.callbackQuery(/^ep_rename:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const exerciseId = Number(ctx.match![1]);
    const exercise = await getExerciseById(exerciseId);
    if (!exercise) {
      await ctx.reply("Вправу не знайдено.");
      return;
    }
    const day = await getWorkoutDayById(exercise.workoutDayId);
    ctx.session.editProgram = {
      mode: "rename",
      dayNumber: day?.dayNumber ?? 1,
      exerciseId,
    };
    await ctx.reply(`Введи нову назву для «${exercise.name}»:`);
  });

  bot.callbackQuery(/^ep_add:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const dayNumber = Number(ctx.match![1]);
    ctx.session.editProgram = { mode: "add", dayNumber };
    await ctx.reply("Введи назву нової вправи (підходи/повтори зможеш налаштувати далі):");
  });

  bot.callbackQuery(/^ep_del:(\d+)$/, async (ctx) => {
    const exerciseId = Number(ctx.match![1]);
    const hasHistory = await exerciseHasHistory(exerciseId);
    if (hasHistory) {
      await ctx.answerCallbackQuery({ text: "Має історію — видалення недоступне" });
      return;
    }
    const exercise = await getExerciseById(exerciseId);
    const dayNumber = exercise
      ? (await getWorkoutDayById(exercise.workoutDayId))?.dayNumber ?? 1
      : 1;
    await deleteExercise(exerciseId);
    await ctx.answerCallbackQuery({ text: "Вправу видалено" });
    await showExerciseList(ctx, dayNumber);
  });

  bot.on("message:text", async (ctx, next) => {
    const editState = ctx.session.editProgram;
    if (!editState) {
      return next();
    }

    const text = ctx.message.text;
    if (MENU_BUTTONS.includes(text)) {
      ctx.session.editProgram = null;
      return next();
    }

    const name = text.trim();
    if (name.length < 2 || name.length > 100) {
      await ctx.reply("Назва має бути від 2 до 100 символів. Спробуй ще раз.");
      return;
    }

    if (editState.mode === "rename" && editState.exerciseId) {
      await renameExercise(editState.exerciseId, name);
      const exerciseId = editState.exerciseId;
      ctx.session.editProgram = null;
      await ctx.reply(`✅ Перейменовано на «${name}».`);
      await showExerciseEditor(ctx, exerciseId);
      return;
    }

    if (editState.mode === "add") {
      const day = await getWorkoutDayByNumber(editState.dayNumber);
      if (!day) {
        ctx.session.editProgram = null;
        await ctx.reply("День не знайдено.");
        return;
      }
      const created = await addExerciseToDay(day.id, name);
      ctx.session.editProgram = null;
      await ctx.reply(`✅ Додано «${name}» (3×10–12, відпочинок 90 с). Налаштуй за потреби:`);
      await showExerciseEditor(ctx, created.id);
      return;
    }

    ctx.session.editProgram = null;
    return next();
  });
}
