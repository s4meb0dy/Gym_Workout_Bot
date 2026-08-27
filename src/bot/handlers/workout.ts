import { Bot, GrammyError, InlineKeyboard } from "grammy";
import { Exercise } from "@prisma/client";
import { BotContext } from "../bot";
import { askConfirm } from "../confirm";
import {
  editCancelKeyboard,
  editSetListKeyboard,
  finishOnlyKeyboard,
  isMainMenuButton,
  mainMenuKeyboard,
  setEntryKeyboard,
  warmupSetKeyboard,
  workoutDayKeyboard,
  workoutMoreKeyboard,
} from "../keyboards";
import {
  parseSetInput,
  formatRepTarget,
  formatRestDuration,
  formatWeight,
  getBaselineWeight,
  ParsedSet,
  ProgressionResult,
  SetResult,
} from "../../services/progression";
import { detectExerciseStall } from "../../services/analytics.service";
import {
  cancelActiveSession,
  completeWorkoutSession,
  deleteLastSet,
  ExerciseState,
  formatWarmupPrompt,
  formatWorkoutSummary,
  getActiveSession,
  getCurrentExerciseState,
  getProgressionForExercise,
  getSessionSets,
  getSetById,
  getTodayExerciseSets,
  getWorkoutDayByNumber,
  getWorkoutDays,
  isWarmupExercise,
  logSet,
  startWorkoutSession,
  updateSet,
  WorkoutQueueOptions,
} from "../../services/workout.service";

function getQueueOptions(ctx: BotContext): WorkoutQueueOptions {
  return {
    postponedExerciseIds: ctx.session.postponedExerciseIds ?? [],
    skippedExerciseIds: ctx.session.skippedExerciseIds ?? [],
  };
}

function clearWorkoutQueue(ctx: BotContext): void {
  ctx.session.postponedExerciseIds = [];
  ctx.session.skippedExerciseIds = [];
}

/** Переносить вправу в кінець черги поточного тренування (можна повернутись пізніше). */
function postponeExerciseInSession(ctx: BotContext, exerciseId: number): void {
  const postponed = (ctx.session.postponedExerciseIds ?? []).filter((id) => id !== exerciseId);
  postponed.push(exerciseId);
  ctx.session.postponedExerciseIds = postponed;
  ctx.session.cardExerciseId = null;
}

/** Повністю пропускає вправу без фіктивних 0×0 у БД. */
function skipExerciseInSession(ctx: BotContext, exerciseId: number): void {
  const skipped = ctx.session.skippedExerciseIds ?? [];
  if (!skipped.includes(exerciseId)) {
    ctx.session.skippedExerciseIds = [...skipped, exerciseId];
  }
  ctx.session.postponedExerciseIds = (ctx.session.postponedExerciseIds ?? []).filter(
    (id) => id !== exerciseId,
  );
  ctx.session.cardExerciseId = null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function candidateWeight(exercise: Exercise, progression: ProgressionResult): number {
  if (progression.suggestedWeight > 0) {
    return progression.suggestedWeight;
  }
  return getBaselineWeight({
    baselineWeightMin: exercise.baselineWeightMin,
    baselineWeightMax: exercise.baselineWeightMax,
  });
}

// ---- Rest timer ----

const restTimers = new Map<number, NodeJS.Timeout>();

export function clearRest(chatId: number): void {
  const timer = restTimers.get(chatId);
  if (timer) {
    clearTimeout(timer);
    restTimers.delete(chatId);
  }
}

function startRestTimer(ctx: BotContext, seconds: number): void {
  if (!ctx.chat || seconds <= 0) {
    return;
  }

  const chatId = ctx.chat.id;
  clearRest(chatId);

  restTimers.set(
    chatId,
    setTimeout(() => {
      restTimers.delete(chatId);
      // Нове повідомлення (а не редагування) — щоб прилетів push на телефон.
      ctx.api
        .sendMessage(
          chatId,
          `🔔 Відпочинок ${formatRestDuration(seconds)} завершено — вперед на наступний підхід!`,
        )
        .catch(() => undefined);
    }, seconds * 1000),
  );
}

// ---- Live card ----

/**
 * Оновлює єдину «живу картку» тренування на місці.
 * Нове повідомлення створюється лише якщо картки більше немає (видалена/застаріла).
 */
async function renderCard(
  ctx: BotContext,
  text: string,
  keyboard: InlineKeyboard,
): Promise<void> {
  if (!ctx.chat) {
    return;
  }

  const cardId = ctx.session.cardMessageId;
  if (cardId) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, cardId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      return;
    } catch (error) {
      // Вміст той самий — картка вже актуальна, дубль не потрібен.
      if (error instanceof GrammyError && error.description.includes("message is not modified")) {
        return;
      }
    }
  }

  const message = await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  ctx.session.cardMessageId = message.message_id;
}

async function clearCard(ctx: BotContext): Promise<void> {
  const cardId = ctx.session.cardMessageId;
  ctx.session.cardMessageId = null;
  ctx.session.cardExerciseId = null;

  if (cardId && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, cardId).catch(() => undefined);
  }
}

/** Повідомлення, за кнопкою якого прийшов апдейт, стає живою карткою. */
function syncCardFromCallback(ctx: BotContext): void {
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (messageId) {
    ctx.session.cardMessageId = messageId;
  }
}

function formatSetList(sets: SetResult[]): string {
  return sets.map((set) => `${formatWeight(set.weight)}×${set.reps}`).join(", ");
}

/**
 * Синхронізує quickWeight/quickReps:
 * 1) якщо в сесії вже є підходи — беремо останній за setNumber;
 * 2) інакше — прогресія з попереднього тренування (лише при зміні вправи).
 */
function syncQuickDefaultsFromSession(
  ctx: BotContext,
  exercise: Exercise,
  session: NonNullable<Awaited<ReturnType<typeof getActiveSession>>>,
  progression: ProgressionResult,
): void {
  const todaySets = getTodayExerciseSets(session.sets, exercise.id);

  if (todaySets.length > 0) {
    const last = todaySets[todaySets.length - 1]!;
    ctx.session.quickWeight = last.weight;
    ctx.session.quickReps = last.reps;
    ctx.session.cardExerciseId = exercise.id;
    return;
  }

  if (ctx.session.cardExerciseId !== exercise.id) {
    ctx.session.cardExerciseId = exercise.id;
    ctx.session.quickWeight = candidateWeight(exercise, progression) || null;
    ctx.session.quickReps =
      progression.lastReps > 0 ? progression.lastReps : exercise.targetRepsMin;
  }
}

function buildSetCard(
  state: ExerciseState,
  progression: ProgressionResult,
  todaySets: SetResult[],
  status?: string,
  stallNote?: string,
): string {
  const exerciseType = state.exercise.exerciseType as "reps" | "time";
  const target = formatRepTarget(
    state.exercise.targetRepsMin,
    state.exercise.targetRepsMax,
    exerciseType,
  );

  let text = status ? `${status}\n\n` : "";

  text +=
    `📍 Вправа ${state.exerciseIndex}/${state.totalExercises} · <b>${escapeHtml(state.exercise.name)}</b>\n` +
    `Підхід ${state.setNumber}/${state.exercise.targetSets} · ціль ${target}\n\n`;

  text += `🕘 Минулого разу: ${
    progression.lastSets.length > 0 ? formatSetList(progression.lastSets) : "—"
  }\n`;

  if (todaySets.length > 0) {
    text += `🔥 Сьогодні: ${formatSetList(todaySets)}\n`;
  }

  if (stallNote) {
    text += `\n${stallNote}\n`;
  }

  if (state.exercise.technique) {
    text += `\n💡 ${escapeHtml(state.exercise.technique)}\n`;
  }

  text += `\n⏱️ Відпочинок: ${formatRestDuration(state.exercise.restTimeInSeconds)}`;
  text += `\n<i>Кнопки або текстом: «100 8», «8», «100 8 @9»</i>`;

  return text;
}

/**
 * Єдина точка рендеру стану тренування. Усі переходи (наступний підхід, наступна
 * вправа, undo, редагування) проходять через неї та оновлюють ту саму картку.
 */
async function renderWorkoutCard(ctx: BotContext, status?: string): Promise<void> {
  ctx.session.editingSetId = null;

  const session = await getActiveSession(ctx.user.id);

  if (!session) {
    ctx.session.awaitingSetInput = false;
    await clearCard(ctx);
    await ctx.reply(status ? `${status}\n\nНемає активного тренування.` : "Немає активного тренування.", {
      reply_markup: mainMenuKeyboard,
    });
    return;
  }

  const state = getCurrentExerciseState(session, getQueueOptions(ctx));

  if (!state) {
    ctx.session.awaitingSetInput = false;
    ctx.session.quickWeight = null;
    ctx.session.quickReps = null;
    ctx.session.cardExerciseId = null;

    await renderCard(
      ctx,
      `${status ? `${status}\n\n` : ""}🎉 <b>Усі вправи виконано!</b>\nНатисни «Фініш», щоб зберегти підсумок.`,
      finishOnlyKeyboard(),
    );
    return;
  }

  const todaySets = getTodayExerciseSets(session.sets, state.exercise.id);

  if (isWarmupExercise(state.exercise)) {
    ctx.session.awaitingSetInput = false;
    ctx.session.quickWeight = null;
    ctx.session.quickReps = null;
    ctx.session.cardExerciseId = state.exercise.id;

    await renderCard(
      ctx,
      (status ? `${status}\n\n` : "") +
        formatWarmupPrompt(
          state.exercise,
          state.setNumber,
          state.exerciseIndex,
          state.totalExercises,
        ),
      warmupSetKeyboard(),
    );
    return;
  }

  const progression = await getProgressionForExercise(
    ctx.user.id,
    state.exercise,
    session.workoutDayId,
  );

  syncQuickDefaultsFromSession(ctx, state.exercise, session, progression);

  ctx.session.awaitingSetInput = true;

  let stallNote: string | undefined;
  if (state.setNumber === 1) {
    const stall = await detectExerciseStall(ctx.user.id, session.workoutDayId, state.exercise.id);
    if (stall.stalled) {
      stallNote =
        `⚠️ <b>Застій</b>: ${formatWeight(stall.weight)} кг тримається ${stall.sessions} тренування поспіль. ` +
        "Варіанти: deload −10%, інший діапазон повторень, або перевір сон і калорії.";
    }
  }

  await renderCard(
    ctx,
    buildSetCard(state, progression, todaySets, status, stallNote),
    setEntryKeyboard(
      ctx.session.quickWeight ?? 0,
      ctx.session.quickReps ?? state.exercise.targetRepsMin,
      state.exercise.progressionStep || 2,
    ),
  );
}

// ---- Logging ----

function defaultReps(ctx: BotContext, exercise: Exercise): number {
  if (ctx.session.quickReps != null && ctx.session.quickReps > 0) {
    return ctx.session.quickReps;
  }
  return exercise.targetRepsMin;
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
    text += `\n<i>(рекомендовано ${formatWeight(progression.suggestedWeight)} кг — ок, якщо в залі інший номінал)</i>`;
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

  // Наступний підхід за замовчуванням повторює те, що тільки що зробили.
  ctx.session.quickWeight = parsed.weight;
  ctx.session.quickReps = parsed.reps;

  const unit = exercise.exerciseType === "time" ? "сек" : "повт.";
  startRestTimer(ctx, exercise.restTimeInSeconds);
  await renderWorkoutCard(ctx, buildConfirmText(parsed, unit, progression));
}

async function handleSetInput(ctx: BotContext, text: string): Promise<void> {
  const session = await getActiveSession(ctx.user.id);

  if (!session) {
    ctx.session.awaitingSetInput = false;
    await renderWorkoutCard(ctx);
    return;
  }

  const state = getCurrentExerciseState(session, getQueueOptions(ctx));
  if (!state) {
    await renderWorkoutCard(ctx);
    return;
  }

  if (isWarmupExercise(state.exercise)) {
    await renderWorkoutCard(ctx, "ℹ️ Вправа без ваги — тисни «✅ Підхід виконано».");
    return;
  }

  const exerciseType = state.exercise.exerciseType as "reps" | "time";
  const parsed = parseSetInput(text, exerciseType, ctx.session.quickWeight ?? undefined);

  if (!parsed) {
    const hint =
      exerciseType === "time"
        ? "«20 45» — вага × секунди"
        : "«100 8», «100x8» або «8» (на поточній вазі)";
    await renderWorkoutCard(
      ctx,
      `⚠️ Не розпізнав «${escapeHtml(text.slice(0, 40))}». Формат: ${hint}`,
    );
    return;
  }

  const progression = await getProgressionForExercise(
    ctx.user.id,
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
    await renderWorkoutCard(ctx, "⚠️ Підхід не знайдено.");
    return;
  }

  const parsed = parseSetInput(text, set.exercise.exerciseType as "reps" | "time", set.weight);
  if (!parsed) {
    await renderCard(
      ctx,
      `✏️ <b>${escapeHtml(set.exercise.name)}</b> — підхід №${set.setNumber}\n` +
        `Зараз: ${formatWeight(set.weight)}×${set.reps}\n\n` +
        "⚠️ Формат: «100 8» або «100x8»",
      editCancelKeyboard(),
    );
    return;
  }

  await updateSet(setId, parsed.weight, parsed.reps, parsed.rpe ?? null, parsed.note ?? null);
  ctx.session.editingSetId = null;

  await renderWorkoutCard(
    ctx,
    `✏️ Оновлено «${escapeHtml(set.exercise.name)}» №${set.setNumber}: ${formatWeight(parsed.weight)}×${parsed.reps}`,
  );
}

// ---- Handlers ----

export function registerWorkoutHandlers(bot: Bot<BotContext>) {
  bot.command("workout", async (ctx) => {
    const days = await getWorkoutDays();
    await ctx.reply("Обери тренувальний день:", { reply_markup: workoutDayKeyboard(days) });
  });

  bot.callbackQuery(/^start_day:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const dayNumber = Number(ctx.match![1]);
    const day = await getWorkoutDayByNumber(dayNumber);

    if (!day) {
      await ctx.reply("День не знайдено.");
      return;
    }

    // Прибираємо вибір дня, щоб картка залишилась єдиним активним екраном.
    await ctx.deleteMessage().catch(() => undefined);

    const active = await getActiveSession(ctx.user.id);

    if (active) {
      await renderWorkoutCard(
        ctx,
        `↩️ Продовжуємо активне тренування «${escapeHtml(active.workoutDay.name)}».`,
      );
      return;
    }

    try {
      await startWorkoutSession(ctx.user.id, day.id);
    } catch (error) {
      if (error instanceof Error && error.message === "ACTIVE_SESSION_EXISTS") {
        await ctx.reply("Активне тренування вже існує.");
        return;
      }
      throw error;
    }

    ctx.session.cardMessageId = null;
    ctx.session.cardExerciseId = null;
    clearWorkoutQueue(ctx);
    await renderWorkoutCard(
      ctx,
      `🔥 Розпочато: <b>${day.weekday} — ${escapeHtml(day.name)}</b>`,
    );
  });

  bot.callbackQuery("warmup_set_done", async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    const state = getCurrentExerciseState(session, getQueueOptions(ctx));
    if (!state || !isWarmupExercise(state.exercise)) {
      await ctx.answerCallbackQuery();
      await renderWorkoutCard(ctx);
      return;
    }

    await ctx.answerCallbackQuery({ text: "Підхід зараховано" });
    await logSet(session.id, state.exercise.id, state.setNumber, 0, state.exercise.targetRepsMax);
    startRestTimer(ctx, state.exercise.restTimeInSeconds);

    await renderWorkoutCard(
      ctx,
      `✅ Підхід ${state.setNumber}/${state.exercise.targetSets} виконано`,
    );
  });

  bot.callbackQuery("qw_noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(["qw_inc", "qw_dec"], async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
    const state = session ? getCurrentExerciseState(session, getQueueOptions(ctx)) : null;

    if (!state || isWarmupExercise(state.exercise)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const step = state.exercise.progressionStep || 2;
    const current =
      ctx.session.quickWeight ??
      getBaselineWeight({
        baselineWeightMin: state.exercise.baselineWeightMin,
        baselineWeightMax: state.exercise.baselineWeightMax,
      });

    const delta = ctx.match === "qw_inc" ? step : -step;
    const next = Math.max(0, Math.round((current + delta) * 10) / 10);
    ctx.session.quickWeight = next;

    const reps = ctx.session.quickReps ?? state.exercise.targetRepsMin;

    await ctx.answerCallbackQuery({ text: `${formatWeight(next)} кг` });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: setEntryKeyboard(next, reps, step) });
    } catch {
      // markup не змінився
    }
  });

  bot.callbackQuery(["qr_inc", "qr_dec"], async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
    const state = session ? getCurrentExerciseState(session, getQueueOptions(ctx)) : null;

    if (!state || isWarmupExercise(state.exercise)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const maxReps = state.exercise.exerciseType === "time" ? 600 : 100;
    const current = ctx.session.quickReps ?? state.exercise.targetRepsMin;
    const delta = ctx.match === "qr_inc" ? 1 : -1;
    const next = Math.min(maxReps, Math.max(1, current + delta));
    ctx.session.quickReps = next;

    const step = state.exercise.progressionStep || 2;
    const weight = ctx.session.quickWeight ?? 0;

    await ctx.answerCallbackQuery({ text: `${next} повт.` });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: setEntryKeyboard(weight, next, step) });
    } catch {
      // markup не змінився
    }
  });

  bot.callbackQuery("qw_more", async (ctx) => {
    syncCardFromCallback(ctx);
    await ctx.answerCallbackQuery();

    // Текст картки лишається — міняється лише набір кнопок.
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: workoutMoreKeyboard() });
    } catch {
      // markup не змінився
    }
  });

  bot.callbackQuery("qw_back", async (ctx) => {
    syncCardFromCallback(ctx);
    await ctx.answerCallbackQuery();
    await renderWorkoutCard(ctx);
  });

  bot.callbackQuery("qw_log", async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
    const state = session ? getCurrentExerciseState(session, getQueueOptions(ctx)) : null;

    if (!session || !state || isWarmupExercise(state.exercise)) {
      await ctx.answerCallbackQuery({ text: "Немає активного підходу" });
      return;
    }

    const weight = ctx.session.quickWeight ?? 0;
    if (weight <= 0) {
      await ctx.answerCallbackQuery({ text: "Вкажи вагу кнопкою ➕ або введи текстом" });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Записано" });

    const progression = await getProgressionForExercise(
      ctx.user.id,
      state.exercise,
      session.workoutDayId,
    );

    await logWorkingSetAndContinue(
      ctx,
      session.id,
      state.exercise,
      state.setNumber,
      { weight, reps: defaultReps(ctx, state.exercise) },
      progression,
    );
  });

  bot.callbackQuery("undo_set", async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
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
    const session = await getActiveSession(ctx.user.id);

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
    await ctx.deleteMessage().catch(() => undefined);

    const status =
      removed.weight > 0
        ? `↩️ Скасовано «${escapeHtml(removed.exercise.name)}»: ${formatWeight(removed.weight)}×${removed.reps}`
        : `↩️ Скасовано підхід «${escapeHtml(removed.exercise.name)}»`;

    await renderWorkoutCard(ctx, status);
  });

  bot.callbackQuery("edit_menu", async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    const sets = await getSessionSets(session.id);
    const working = sets.filter((s) => s.weight > 0 || s.reps > 0).slice(-8);

    if (working.length === 0) {
      await ctx.answerCallbackQuery({ text: "Поки немає записаних підходів" });
      return;
    }

    await ctx.answerCallbackQuery();
    ctx.session.awaitingSetInput = false;

    const buttons = working.map((s) => ({
      id: s.id,
      label: `${s.exercise.name} — №${s.setNumber}: ${formatWeight(s.weight)}×${s.reps}`,
    }));

    await renderCard(
      ctx,
      "✏️ <b>Виправити підхід</b>\nОбери запис, який треба змінити:",
      editSetListKeyboard(buttons),
    );
  });

  bot.callbackQuery(/^edit_set:(.+)$/, async (ctx) => {
    syncCardFromCallback(ctx);

    const setId = ctx.match![1]!;
    const set = await getSetById(setId);

    if (!set) {
      await ctx.answerCallbackQuery({ text: "Підхід не знайдено" });
      await renderWorkoutCard(ctx);
      return;
    }

    await ctx.answerCallbackQuery();
    ctx.session.editingSetId = setId;
    ctx.session.awaitingSetInput = false;

    await renderCard(
      ctx,
      `✏️ <b>${escapeHtml(set.exercise.name)}</b> — підхід №${set.setNumber}\n` +
        `Зараз: ${formatWeight(set.weight)}×${set.reps}\n\n` +
        "Введи нове значення: «100 8» або «100x8»",
      editCancelKeyboard(),
    );
  });

  bot.callbackQuery("edit_cancel", async (ctx) => {
    syncCardFromCallback(ctx);
    await ctx.answerCallbackQuery();
    ctx.session.editingSetId = null;
    await renderWorkoutCard(ctx);
  });

  bot.callbackQuery("act:postpone_exercise", async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    const state = getCurrentExerciseState(session, getQueueOptions(ctx));
    if (!state) {
      await ctx.answerCallbackQuery({ text: "Усі вправи виконано" });
      await renderWorkoutCard(ctx);
      return;
    }

    if (ctx.chat) {
      clearRest(ctx.chat.id);
    }

    postponeExerciseInSession(ctx, state.exercise.id);
    await ctx.answerCallbackQuery({ text: "Вправу відкладено" });

    await renderWorkoutCard(
      ctx,
      `⏸️ «${escapeHtml(state.exercise.name)}» відкладено в кінець — повернемось, коли звільниться тренажер`,
    );
  });

  bot.callbackQuery("skip_to_next", async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    const state = getCurrentExerciseState(session, getQueueOptions(ctx));
    if (!state) {
      await ctx.answerCallbackQuery({ text: "Усі вправи виконано" });
      await renderWorkoutCard(ctx);
      return;
    }

    const remainingSets = state.exercise.targetSets - state.setNumber + 1;
    await askConfirm(
      ctx,
      `⏭️ <b>Пропустити зовсім «${escapeHtml(state.exercise.name)}»?</b>\n` +
        `Залишилось ${remainingSets} підх. — вправу буде завершено без записів у БД (аналітика не зіпсується).`,
      "skip_to_next",
    );
  });

  bot.callbackQuery("cfm:skip_to_next", async (ctx) => {
    const session = await getActiveSession(ctx.user.id);

    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      return;
    }

    const state = getCurrentExerciseState(session, getQueueOptions(ctx));
    if (!state) {
      await ctx.answerCallbackQuery({ text: "Усі вправи виконано" });
      return;
    }

    if (ctx.chat) {
      clearRest(ctx.chat.id);
    }

    skipExerciseInSession(ctx, state.exercise.id);
    await ctx.answerCallbackQuery({ text: "Вправу пропущено" });
    await ctx.deleteMessage().catch(() => undefined);

    await renderWorkoutCard(
      ctx,
      `⏭️ «${escapeHtml(state.exercise.name)}» пропущено зовсім`,
    );
  });

  bot.callbackQuery("finish_workout", async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      ctx.session.awaitingSetInput = false;
      await clearCard(ctx);
      await ctx.reply("Немає активного тренування.", { reply_markup: mainMenuKeyboard });
      return;
    }

    await askConfirm(ctx, "✅ <b>Завершити тренування?</b>\nПідсумок буде збережено.", "finish_workout");
  });

  bot.callbackQuery("cfm:finish_workout", async (ctx) => {
    const session = await getActiveSession(ctx.user.id);

    if (!session) {
      await ctx.answerCallbackQuery({ text: "Немає активного тренування" });
      ctx.session.awaitingSetInput = false;
      await clearCard(ctx);
      await ctx.reply("Немає активного тренування.", { reply_markup: mainMenuKeyboard });
      return;
    }

    if (ctx.chat) {
      clearRest(ctx.chat.id);
    }

    const summary = await completeWorkoutSession(session.id);
    ctx.session.awaitingSetInput = false;
    ctx.session.quickWeight = null;
    ctx.session.quickReps = null;
    ctx.session.editingSetId = null;
    clearWorkoutQueue(ctx);

    await ctx.answerCallbackQuery({ text: "Тренування завершено" });
    await ctx.deleteMessage().catch(() => undefined);
    await clearCard(ctx);

    await ctx.reply(formatWorkoutSummary(summary), {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard,
    });
  });

  bot.callbackQuery("cancel_workout", async (ctx) => {
    syncCardFromCallback(ctx);

    const session = await getActiveSession(ctx.user.id);
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
    if (ctx.chat) {
      clearRest(ctx.chat.id);
    }

    await cancelActiveSession(ctx.user.id);
    ctx.session.awaitingSetInput = false;
    ctx.session.quickWeight = null;
    ctx.session.quickReps = null;
    ctx.session.editingSetId = null;
    clearWorkoutQueue(ctx);

    await ctx.answerCallbackQuery({ text: "Тренування скасовано" });
    await ctx.deleteMessage().catch(() => undefined);
    await clearCard(ctx);

    await ctx.reply("Тренування скасовано.", { reply_markup: mainMenuKeyboard });
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;

    if (ctx.session.editingSetId) {
      if (isMainMenuButton(text)) {
        ctx.session.editingSetId = null;
        return next();
      }
      // Прибираємо ввід, щоб картка залишалась найнижчим повідомленням у чаті.
      await ctx.deleteMessage().catch(() => undefined);
      await handleEditInput(ctx, text);
      return;
    }

    if (!ctx.session.awaitingSetInput) {
      return next();
    }

    if (isMainMenuButton(text)) {
      ctx.session.awaitingSetInput = false;
      return next();
    }

    await ctx.deleteMessage().catch(() => undefined);
    await handleSetInput(ctx, text);
  });
}
