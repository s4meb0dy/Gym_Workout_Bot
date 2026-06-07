import { Bot } from "grammy";
import { Exercise } from "@prisma/client";
import { BotContext } from "../bot";
import { askConfirm } from "../confirm";
import {
  editCancelKeyboard,
  editSetListKeyboard,
  finishOnlyKeyboard,
  mainMenuKeyboard,
  quickWeightKeyboard,
  warmupSetKeyboard,
  workoutControlKeyboard,
  workoutDayKeyboard,
} from "../keyboards";
import {
  parseSetInput,
  formatRestDuration,
  formatWeight,
  ParsedSet,
  ProgressionResult,
} from "../../services/progression";
import { detectExerciseStall } from "../../services/analytics.service";
import {
  cancelActiveSession,
  completeWorkoutSession,
  deleteLastSet,
  findOrCreateUser,
  formatExercisePrompt,
  formatWarmupPrompt,
  formatWorkoutSummary,
  getActiveSession,
  getCurrentExerciseState,
  getProgressionForExercise,
  getSessionSets,
  getSetById,
  getWorkoutDayByNumber,
  getWorkoutDays,
  isWarmupExercise,
  isWorkoutComplete,
  logSet,
  reloadSession,
  startWorkoutSession,
  updateSet,
} from "../../services/workout.service";

const MENU_BUTTONS = [
  "🏋️ Розпочати тренування",
  "📋 Моя програма (4 дні)",
  "📊 Статистика та рекорди",
  "⚖️ Вага тіла",
  "🍗 Білок",
  "🛠 Інструменти",
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function baselineMidpoint(exercise: Exercise): number {
  if (exercise.baselineWeightMin != null && exercise.baselineWeightMax != null) {
    return (exercise.baselineWeightMin + exercise.baselineWeightMax) / 2;
  }
  return exercise.baselineWeightMin ?? exercise.baselineWeightMax ?? 0;
}

function candidateWeight(exercise: Exercise, progression: ProgressionResult): number {
  if (progression.suggestedWeight > 0) {
    return progression.suggestedWeight;
  }
  return baselineMidpoint(exercise);
}

// Informational rest timer — does NOT block input.
function startRestCountdown(ctx: BotContext, seconds: number): void {
  const label = formatRestDuration(seconds);
  ctx
    .reply(`⏱️ Відпочинок: ${label}.`)
    .then((message) => {
      setTimeout(() => {
        ctx.api
          .editMessageText(
            message.chat.id,
            message.message_id,
            `🔔 Відпочинок ${label} завершено — вперед на наступний підхід!`,
          )
          .catch(() => undefined);
      }, seconds * 1000);
    })
    .catch(() => undefined);
}

async function sendCurrentExercise(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    return;
  }

  ctx.session.editingSetId = null;

  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const session = await getActiveSession(user.id);

  if (!session) {
    ctx.session.awaitingSetInput = false;
    await ctx.reply("Немає активного тренування.", { reply_markup: mainMenuKeyboard });
    return;
  }

  const state = getCurrentExerciseState(session);

  if (!state) {
    ctx.session.awaitingSetInput = false;
    await ctx.reply("🎉 Усі вправи виконано! Натисни «Фініш», щоб побачити підсумок.", {
      reply_markup: finishOnlyKeyboard(),
    });
    return;
  }

  if (isWarmupExercise(state.exercise)) {
    ctx.session.awaitingSetInput = false;
    ctx.session.quickWeight = null;
    await ctx.reply(
      formatWarmupPrompt(state.exercise, state.setNumber, state.exerciseIndex, state.totalExercises),
      { parse_mode: "HTML", reply_markup: warmupSetKeyboard() },
    );
    return;
  }

  const progression = await getProgressionForExercise(
    user.id,
    state.exercise,
    session.workoutDayId,
  );

  ctx.session.awaitingSetInput = true;

  const candidate = candidateWeight(state.exercise, progression);
  ctx.session.quickWeight = candidate > 0 ? candidate : null;
  const keyboard =
    candidate > 0
      ? quickWeightKeyboard(candidate, state.exercise.progressionStep, state.exercise.targetRepsMax)
      : workoutControlKeyboard();

  await ctx.reply(
    formatExercisePrompt(
      state.exercise,
      state.setNumber,
      progression,
      state.exerciseIndex,
      state.totalExercises,
    ),
    { parse_mode: "HTML", reply_markup: keyboard },
  );

  if (state.setNumber === 1) {
    const stall = await detectExerciseStall(user.id, session.workoutDayId, state.exercise.id);
    if (stall.stalled) {
      await ctx.reply(
        `⚠️ <b>Застій</b>: вага ${formatWeight(stall.weight)} кг тримається вже ${stall.sessions} тренування поспіль.\n` +
          "Варіанти: знизь ~10% і відбудуйся 1–2 тижні (deload), зміни діапазон повторень, " +
          "або перевір сон, калорії та техніку.",
        { parse_mode: "HTML" },
      );
    }
  }
}

async function advanceAfterExerciseFinished(
  ctx: BotContext,
  sessionId: string,
  finishedExercise: Exercise,
): Promise<void> {
  ctx.session.quickWeight = null;
  const updated = await reloadSession(sessionId);

  if (isWorkoutComplete(updated)) {
    ctx.session.awaitingSetInput = false;
    await ctx.reply("🎉 Усі вправи виконано! Натисни «Фініш», щоб побачити підсумок.", {
      reply_markup: finishOnlyKeyboard(),
    });
    return;
  }

  if (isWarmupExercise(finishedExercise)) {
    await ctx.reply("✅ Розминку завершено! Переходимо до робочих вправ 💪");
  } else {
    await ctx.reply(`✅ Вправу «${finishedExercise.name}» завершено!`);
  }

  startRestCountdown(ctx, finishedExercise.restTimeInSeconds);
  await sendCurrentExercise(ctx);
}

function buildConfirmText(parsed: ParsedSet, unit: string, progression?: ProgressionResult): string {
  let text = `✅ Записано: <b>${formatWeight(parsed.weight)} кг × ${parsed.reps} ${unit}</b>`;
  if (parsed.rpe) {
    text += ` • RPE ${formatWeight(parsed.rpe)}`;
  }
  if (parsed.note) {
    text += `\n📝 ${escapeHtml(parsed.note)}`;
  }
  if (
    progression &&
    progression.suggestedWeight > 0 &&
    Math.abs(parsed.weight - progression.suggestedWeight) >= 0.1
  ) {
    text += `\n<i>(рекомендовано було ${formatWeight(progression.suggestedWeight)} кг — ок, якщо в залі інший номінал)</i>`;
  }
  return text;
}

async function logWorkingSetAndContinue(
  ctx: BotContext,
  sessionId: string,
  exercise: Exercise,
  setNumber: number,
  parsed: ParsedSet,
  progression?: ProgressionResult,
): Promise<void> {
  await logSet(sessionId, exercise.id, setNumber, parsed.weight, parsed.reps, parsed.rpe, parsed.note);

  const exerciseSets = (await reloadSession(sessionId)).sets.filter(
    (s) => s.exerciseId === exercise.id,
  );
  const isExerciseDone = exerciseSets.length >= exercise.targetSets;
  const exerciseType = exercise.exerciseType as "reps" | "time";
  const unit = exerciseType === "time" ? "сек" : "повторень";
  const confirmText = buildConfirmText(parsed, unit, progression);

  if (isExerciseDone) {
    await ctx.reply(confirmText, { parse_mode: "HTML" });
    await advanceAfterExerciseFinished(ctx, sessionId, exercise);
    return;
  }

  const nextSetNumber = exerciseSets.length + 1;
  const candidate = parsed.weight;
  ctx.session.quickWeight = candidate;
  ctx.session.awaitingSetInput = true;

  await ctx.reply(
    `${confirmText}\n\n▶️ Підхід <b>${nextSetNumber}/${exercise.targetSets}</b> — натисни «Записати» або введи свій результат.`,
    {
      parse_mode: "HTML",
      reply_markup: quickWeightKeyboard(candidate, exercise.progressionStep, exercise.targetRepsMax),
    },
  );
  startRestCountdown(ctx, exercise.restTimeInSeconds);
}

async function handleSetInput(ctx: BotContext, text: string): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const session = await getActiveSession(user.id);

  if (!session) {
    ctx.session.awaitingSetInput = false;
    await ctx.reply("Немає активного тренування.", { reply_markup: mainMenuKeyboard });
    return;
  }

  const state = getCurrentExerciseState(session);
  if (!state) {
    ctx.session.awaitingSetInput = false;
    await ctx.reply("Усі вправи вже виконано.", { reply_markup: finishOnlyKeyboard() });
    return;
  }

  if (isWarmupExercise(state.exercise)) {
    await ctx.reply("Це розминка — підтверди підхід кнопкою «✅ Підхід виконано».", {
      reply_markup: warmupSetKeyboard(),
    });
    return;
  }

  const exerciseType = state.exercise.exerciseType as "reps" | "time";
  const parsed = parseSetInput(text, exerciseType);
  if (!parsed) {
    const hint =
      exerciseType === "time"
        ? "<code>20x45</code> (вага × секунди)"
        : "<code>14x10</code> (вага × повторення). Можна додати RPE: <code>14x10 @8</code>";
    await ctx.reply(`Не вдалося розпізнати формат. Введи у вигляді ${hint}`, {
      parse_mode: "HTML",
    });
    return;
  }

  const progression = await getProgressionForExercise(
    user.id,
    state.exercise,
    session.workoutDayId,
  );

  await logWorkingSetAndContinue(
    ctx,
    session.id,
    state.exercise,
    state.setNumber,
    parsed,
    progression,
  );
}

async function handleEditInput(ctx: BotContext, text: string): Promise<void> {
  const setId = ctx.session.editingSetId;
  if (!setId) {
    return;
  }

  const set = await getSetById(setId);
  if (!set) {
    ctx.session.editingSetId = null;
    await ctx.reply("Підхід не знайдено.");
    await sendCurrentExercise(ctx);
    return;
  }

  const parsed = parseSetInput(text, set.exercise.exerciseType as "reps" | "time");
  if (!parsed) {
    await ctx.reply("Формат: <code>вага x повторення</code>, напр. <code>16x10</code>", {
      parse_mode: "HTML",
      reply_markup: editCancelKeyboard(),
    });
    return;
  }

  await updateSet(setId, parsed.weight, parsed.reps, parsed.rpe ?? null, parsed.note ?? null);
  ctx.session.editingSetId = null;

  await ctx.reply(
    `✏️ Оновлено: «${set.exercise.name}» — ${formatWeight(parsed.weight)} кг × ${parsed.reps}`,
  );
  await sendCurrentExercise(ctx);
}

export function registerWorkoutHandlers(bot: Bot<BotContext>) {
  bot.command("workout", async (ctx) => {
    const days = await getWorkoutDays();
    await ctx.reply("Обери тренувальний день:", { reply_markup: workoutDayKeyboard(days) });
  });

  bot.callbackQuery(/^start_day:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    if (!ctx.from) {
      return;
    }

    const dayNumber = Number(ctx.match![1]);
    const day = await getWorkoutDayByNumber(dayNumber);

    if (!day) {
      await ctx.reply("День не знайдено.");
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const active = await getActiveSession(user.id);

    if (active) {
      await ctx.reply(
        `У тебе вже є активне тренування: «${active.workoutDay.name}».\n` +
          "Продовжуємо з поточного місця (або натисни «❌ Скасувати тренування»).",
      );
      await sendCurrentExercise(ctx);
      return;
    }

    try {
      await startWorkoutSession(user.id, day.id);
    } catch (error) {
      if (error instanceof Error && error.message === "ACTIVE_SESSION_EXISTS") {
        await ctx.reply("Активне тренування вже існує.");
        return;
      }
      throw error;
    }

    await ctx.reply(`🔥 Розпочато: <b>${day.weekday} — ${day.name}</b>`, { parse_mode: "HTML" });
    await sendCurrentExercise(ctx);
  });

  bot.callbackQuery("warmup_set_done", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Підхід зараховано" });

    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);

    if (!session) {
      await ctx.reply("Немає активного тренування.");
      return;
    }

    const state = getCurrentExerciseState(session);
    if (!state || !isWarmupExercise(state.exercise)) {
      await sendCurrentExercise(ctx);
      return;
    }

    await logSet(session.id, state.exercise.id, state.setNumber, 0, state.exercise.targetRepsMax);

    const exerciseSets = (await reloadSession(session.id)).sets.filter(
      (s) => s.exerciseId === state.exercise.id,
    );
    const isExerciseDone = exerciseSets.length >= state.exercise.targetSets;

    await ctx.reply(
      `✅ Підхід ${state.setNumber}/${state.exercise.targetSets} виконано (${state.exercise.targetRepsMax} повторень)`,
    );

    if (isExerciseDone) {
      await advanceAfterExerciseFinished(ctx, session.id, state.exercise);
      return;
    }

    await sendCurrentExercise(ctx);
    startRestCountdown(ctx, state.exercise.restTimeInSeconds);
  });

  bot.callbackQuery("qw_noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(["qw_inc", "qw_dec"], async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);
    const state = session ? getCurrentExerciseState(session) : null;

    if (!state || isWarmupExercise(state.exercise)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const step = state.exercise.progressionStep || 2;
    const current = ctx.session.quickWeight ?? candidateWeight(state.exercise, {
      lastWeight: 0,
      lastReps: 0,
      suggestedWeight: 0,
      shouldIncreaseWeight: false,
      message: "",
    });
    const delta = ctx.match === "qw_inc" ? step : -step;
    const next = Math.max(0, Math.round((current + delta) * 10) / 10);
    ctx.session.quickWeight = next;

    await ctx.answerCallbackQuery({ text: `${formatWeight(next)} кг` });
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: quickWeightKeyboard(next, step, state.exercise.targetRepsMax),
      });
    } catch {
      // ignore "message not modified"
    }
  });

  bot.callbackQuery("qw_log", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);
    const state = session ? getCurrentExerciseState(session) : null;

    if (!session || !state || isWarmupExercise(state.exercise)) {
      await ctx.answerCallbackQuery({ text: "Немає активного підходу" });
      return;
    }

    const weight = ctx.session.quickWeight ?? 0;
    if (weight <= 0) {
      await ctx.answerCallbackQuery({ text: "Вкажи вагу або введи результат вручну" });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Записано" });

    const progression = await getProgressionForExercise(
      user.id,
      state.exercise,
      session.workoutDayId,
    );

    await logWorkingSetAndContinue(
      ctx,
      session.id,
      state.exercise,
      state.setNumber,
      { weight, reps: state.exercise.targetRepsMax },
      progression,
    );
  });

  bot.callbackQuery("undo_set", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);

    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    const sets = await getSessionSets(session.id);
    if (sets.length === 0) {
      await ctx.answerCallbackQuery({ text: "Немає що скасовувати" });
      return;
    }

    await askConfirm(ctx, "↩️ <b>Скасувати останній записаний підхід?</b>", "undo_set");
  });

  bot.callbackQuery("cfm:undo_set", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);

    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    const removed = await deleteLastSet(session.id);
    if (!removed) {
      await ctx.answerCallbackQuery({ text: "Немає що скасовувати" });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Останній підхід видалено" });
    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }

    if (removed.weight > 0) {
      await ctx.reply(
        `↩️ Скасовано: «${removed.exercise.name}» — ${formatWeight(removed.weight)} кг × ${removed.reps}`,
      );
    } else {
      await ctx.reply(`↩️ Скасовано підхід: «${removed.exercise.name}»`);
    }

    await sendCurrentExercise(ctx);
  });

  bot.callbackQuery("edit_menu", async (ctx) => {
    await ctx.answerCallbackQuery();

    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);

    if (!session) {
      await ctx.reply("Немає активного тренування.");
      return;
    }

    const sets = await getSessionSets(session.id);
    const working = sets.filter((s) => s.weight > 0 || s.reps > 0).slice(-8);

    if (working.length === 0) {
      await ctx.reply("Поки немає записаних підходів для редагування.");
      return;
    }

    const buttons = working.map((s) => ({
      id: s.id,
      label: `${s.exercise.name} — №${s.setNumber}: ${formatWeight(s.weight)}×${s.reps}`,
    }));

    ctx.session.awaitingSetInput = false;
    await ctx.reply("Обери підхід, який треба виправити:", {
      reply_markup: editSetListKeyboard(buttons),
    });
  });

  bot.callbackQuery(/^edit_set:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const setId = ctx.match![1];
    const set = await getSetById(setId);
    if (!set) {
      await ctx.reply("Підхід не знайдено.");
      await sendCurrentExercise(ctx);
      return;
    }

    ctx.session.editingSetId = setId;
    ctx.session.awaitingSetInput = false;

    await ctx.reply(
      `✏️ Редагуємо «${set.exercise.name}» — №${set.setNumber} (зараз ${formatWeight(set.weight)}×${set.reps}).\n` +
        "Введи нове значення: <code>вага x повторення</code>",
      { parse_mode: "HTML", reply_markup: editCancelKeyboard() },
    );
  });

  bot.callbackQuery("edit_cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.editingSetId = null;
    await sendCurrentExercise(ctx);
  });

  bot.callbackQuery("skip_to_next", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);

    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    const state = getCurrentExerciseState(session);
    if (!state) {
      await ctx.answerCallbackQuery({ text: "Усі вправи виконано" });
      await ctx.reply("Усі вправи виконано.", { reply_markup: finishOnlyKeyboard() });
      return;
    }

    const remainingSets = state.exercise.targetSets - state.setNumber + 1;
    await askConfirm(
      ctx,
      `⏭️ <b>Пропустити решту підходів (${remainingSets}) для «${state.exercise.name}»?</b>\n` +
        "Решта підходів буде записана як пропущені (0×0).",
      "skip_to_next",
    );
  });

  bot.callbackQuery("cfm:skip_to_next", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);

    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    const state = getCurrentExerciseState(session);
    if (!state) {
      await ctx.answerCallbackQuery({ text: "Усі вправи виконано" });
      return;
    }

    const remainingSets = state.exercise.targetSets - state.setNumber + 1;
    await ctx.answerCallbackQuery({ text: "Вправу пропущено" });
    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }

    await ctx.reply(`⏭️ Пропущено решту підходів (${remainingSets}) для «${state.exercise.name}».`);

    for (let i = state.setNumber; i <= state.exercise.targetSets; i++) {
      await logSet(session.id, state.exercise.id, i, 0, 0);
    }

    await advanceAfterExerciseFinished(ctx, session.id, state.exercise);
  });

  bot.callbackQuery("finish_workout", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);

    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      ctx.session.awaitingSetInput = false;
      await ctx.reply("Немає активного тренування.", { reply_markup: mainMenuKeyboard });
      return;
    }

    await askConfirm(ctx, "✅ <b>Завершити тренування?</b>\nПідсумок буде збережено.", "finish_workout");
  });

  bot.callbackQuery("cfm:finish_workout", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);

    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      ctx.session.awaitingSetInput = false;
      await ctx.reply("Немає активного тренування.", { reply_markup: mainMenuKeyboard });
      return;
    }

    const summary = await completeWorkoutSession(session.id);
    ctx.session.awaitingSetInput = false;
    ctx.session.quickWeight = null;
    ctx.session.editingSetId = null;

    await ctx.answerCallbackQuery({ text: "Тренування завершено" });
    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }

    await ctx.reply(formatWorkoutSummary(summary), {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard,
    });
  });

  bot.callbackQuery("cancel_workout", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const session = await getActiveSession(user.id);

    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    await askConfirm(
      ctx,
      "❌ <b>Скасувати тренування?</b>\nУсі записи цієї сесії будуть видалені без можливості відновлення.",
      "cancel_workout",
    );
  });

  bot.callbackQuery("cfm:cancel_workout", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const user = await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    await cancelActiveSession(user.id);
    ctx.session.awaitingSetInput = false;
    ctx.session.quickWeight = null;
    ctx.session.editingSetId = null;

    await ctx.answerCallbackQuery({ text: "Тренування скасовано" });
    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }

    await ctx.reply("Тренування скасовано.", { reply_markup: mainMenuKeyboard });
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;

    if (ctx.session.editingSetId) {
      if (MENU_BUTTONS.includes(text)) {
        ctx.session.editingSetId = null;
        return next();
      }
      await handleEditInput(ctx, text);
      return;
    }

    if (!ctx.session.awaitingSetInput) {
      return next();
    }

    if (MENU_BUTTONS.includes(text)) {
      ctx.session.awaitingSetInput = false;
      return next();
    }

    await handleSetInput(ctx, text);
  });
}
