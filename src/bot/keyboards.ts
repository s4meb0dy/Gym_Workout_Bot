import { InlineKeyboard, Keyboard } from "grammy";
import { formatWeight } from "../services/progression";

export const mainMenuKeyboard = new Keyboard()
  .text("🏋️ Розпочати тренування")
  .row()
  .text("📋 Моя програма (4 дні)")
  .text("📊 Статистика та рекорди")
  .row()
  .text("⚖️ Вага тіла")
  .text("🍗 Білок")
  .row()
  .text("💧 Вода")
  .text("🛠 Інструменти")
  .resized()
  .persistent();

export function toolsKeyboard() {
  return new InlineKeyboard()
    .text("📈 Обсяг по м'язах (тиждень)", "tools_volume")
    .row()
    .text("🏆 Прогрес вправи (1ПМ)", "tools_progress")
    .row()
    .text("📜 Історія тренувань", "tools_history")
    .text("📅 Тижневий підсумок", "tools_digest")
    .row()
    .text("✏️ Редагувати програму", "tools_editprogram")
    .row()
    .text("🔔 Нагадування", "tools_reminders")
    .row()
    .text("💾 Бекап БД", "tools_backup")
    .text("📤 Експорт CSV", "tools_export");
}

export interface DayButtonInfo {
  dayNumber: number;
  weekday: string;
  name: string;
}

function shortDayName(name: string): string {
  return name.split("(")[0].trim();
}

function buildDayKeyboard(days: DayButtonInfo[], action: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  days.forEach((day, index) => {
    keyboard.text(`${day.weekday} · ${shortDayName(day.name)}`, `${action}:${day.dayNumber}`);
    if (index % 2 === 1) {
      keyboard.row();
    }
  });
  return keyboard;
}

export function workoutDayKeyboard(days: DayButtonInfo[]) {
  return buildDayKeyboard(days, "start_day");
}

export function programDayKeyboard(days: DayButtonInfo[]) {
  return buildDayKeyboard(days, "program_day");
}

export function warmupSetKeyboard() {
  return new InlineKeyboard()
    .text("✅ Підхід виконано", "warmup_set_done")
    .row()
    .text("↩️ Скасувати підхід", "undo_set")
    .row()
    .text("⏭️ Пропустити вправу", "skip_to_next")
    .row()
    .text("✅ Фініш", "finish_workout")
    .text("❌ Скасувати тренування", "cancel_workout");
}

export function workoutControlKeyboard() {
  return new InlineKeyboard()
    .text("↩️ Скасувати підхід", "undo_set")
    .row()
    .text("✏️ Виправити підхід", "edit_menu")
    .text("⏭️ Пропустити вправу", "skip_to_next")
    .row()
    .text("✅ Фініш", "finish_workout")
    .text("❌ Скасувати тренування", "cancel_workout");
}

export function quickWeightKeyboard(candidate: number, step: number, repsMax: number) {
  return new InlineKeyboard()
    .text(`➖ ${formatWeight(step)}`, "qw_dec")
    .text(`${formatWeight(candidate)} кг`, "qw_noop")
    .text(`➕ ${formatWeight(step)}`, "qw_inc")
    .row()
    .text(`✅ Записати ${formatWeight(candidate)} × ${repsMax}`, "qw_log")
    .row()
    .text("↩️ Скасувати підхід", "undo_set")
    .row()
    .text("✏️ Виправити підхід", "edit_menu")
    .text("⏭️ Пропустити вправу", "skip_to_next")
    .row()
    .text("✅ Фініш", "finish_workout")
    .text("❌ Скасувати тренування", "cancel_workout");
}

export function editSetListKeyboard(sets: Array<{ id: string; label: string }>) {
  const keyboard = new InlineKeyboard();
  for (const set of sets) {
    keyboard.text(set.label, `edit_set:${set.id}`).row();
  }
  keyboard.text("⬅️ Назад до тренування", "edit_cancel");
  return keyboard;
}

export function editCancelKeyboard() {
  return new InlineKeyboard().text("⬅️ Скасувати редагування", "edit_cancel");
}

export function reminderSettingsKeyboard(setting: {
  workoutEnabled: boolean;
  proteinEnabled: boolean;
  backupEnabled: boolean;
  digestEnabled: boolean;
  supplementsEnabled: boolean;
  waterEnabled: boolean;
  workoutHour: number;
  proteinHour: number;
  supplementsHour: number;
  proteinTarget: number;
  waterTargetMl: number;
}) {
  const waterLiters = (setting.waterTargetMl / 1000).toFixed(setting.waterTargetMl % 1000 === 0 ? 0 : 1);
  return new InlineKeyboard()
    .text(
      `${setting.workoutEnabled ? "✅" : "⬜"} Нагадування про тренування (${setting.workoutHour}:00)`,
      "rem_toggle_workout",
    )
    .row()
    .text(
      `${setting.proteinEnabled ? "✅" : "⬜"} Нагадування про білок (${setting.proteinHour}:00)`,
      "rem_toggle_protein",
    )
    .row()
    .text(
      `${setting.supplementsEnabled ? "✅" : "⬜"} Добавки: омега-3, магній, D-3 (${setting.supplementsHour}:00)`,
      "rem_toggle_supplements",
    )
    .row()
    .text(`${setting.waterEnabled ? "✅" : "⬜"} Нагадування про воду (12/16/20:00)`, "rem_toggle_water")
    .row()
    .text(`${setting.digestEnabled ? "✅" : "⬜"} Тижневий підсумок (Нд 19:00)`, "rem_toggle_digest")
    .row()
    .text(`${setting.backupEnabled ? "✅" : "⬜"} Щоденний бекап БД`, "rem_toggle_backup")
    .row()
    .text("🍗 Ціль білка: −10", "rem_protein_minus")
    .text(`${setting.proteinTarget} г`, "rem_noop")
    .text("+10", "rem_protein_plus")
    .row()
    .text("💧 Ціль води: −250", "rem_water_minus")
    .text(`${waterLiters} л`, "rem_noop")
    .text("+250", "rem_water_plus");
}

export function finishOnlyKeyboard() {
  return new InlineKeyboard()
    .text("✅ Фініш", "finish_workout")
    .text("❌ Скасувати тренування", "cancel_workout");
}

export function backToMenuKeyboard() {
  return new InlineKeyboard().text("🏠 Головне меню", "back_to_menu");
}

export function foodConfirmKeyboard() {
  return new InlineKeyboard()
    .text("✅ Записати", "food_log")
    .row()
    .text("✏️ Ввести КБЖВ вручну", "food_edit")
    .row()
    .text("❌ Скасувати", "food_cancel");
}

export function editProgramDayKeyboard(days: DayButtonInfo[]) {
  const keyboard = new InlineKeyboard();
  days.forEach((day, index) => {
    keyboard.text(`${day.weekday} · ${shortDayName(day.name)}`, `ep_day:${day.dayNumber}`);
    if (index % 2 === 1) {
      keyboard.row();
    }
  });
  return keyboard;
}

export function editProgramExerciseListKeyboard(
  dayNumber: number,
  exercises: Array<{ id: number; name: string }>,
) {
  const keyboard = new InlineKeyboard();
  exercises.forEach((ex, index) => {
    keyboard.text(ex.name, `ep_ex:${ex.id}`);
    keyboard.text(index === 0 ? "·" : "⬆️", index === 0 ? "ep_noop" : `ep_up:${ex.id}`);
    keyboard.text(
      index === exercises.length - 1 ? "·" : "⬇️",
      index === exercises.length - 1 ? "ep_noop" : `ep_down:${ex.id}`,
    );
    keyboard.row();
  });
  keyboard.text("➕ Додати вправу", `ep_add:${dayNumber}`).row();
  keyboard.text("🏠 Головне меню", "back_to_menu");
  return keyboard;
}

export function bodyWeightListKeyboard(entries: Array<{ id: string; label: string }>) {
  const keyboard = new InlineKeyboard();
  for (const entry of entries) {
    keyboard.text(entry.label, `bw:${entry.id}`).row();
  }
  keyboard.text("🏠 Головне меню", "back_to_menu");
  return keyboard;
}

export function bodyWeightEntryKeyboard(id: string) {
  return new InlineKeyboard()
    .text("✏️ Змінити", `bw_edit:${id}`)
    .text("🗑 Видалити", `bw_del:${id}`)
    .row()
    .text("⬅️ До списку", "bw_list");
}

export function nutritionListKeyboard(
  date: string,
  entries: Array<{ id: string; label: string }>,
  nav: { prev: string; next: string | null },
) {
  const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  const keyboard = new InlineKeyboard();
  for (const entry of entries) {
    keyboard.text(entry.label, `nl:${entry.id}`).row();
  }
  keyboard.text(`◀️ ${ddmm(nav.prev)}`, `nl_list:${nav.prev}`);
  if (nav.next) {
    keyboard.text(`${ddmm(nav.next)} ▶️`, `nl_list:${nav.next}`);
  }
  keyboard.row();
  keyboard.text("🏠 Головне меню", "back_to_menu");
  return keyboard;
}

export function nutritionEntryKeyboard(id: string, date: string) {
  return new InlineKeyboard()
    .text("✏️ Змінити", `nl_edit:${id}`)
    .text("🗑 Видалити", `nl_del:${id}`)
    .row()
    .text("⬅️ До списку", `nl_list:${date}`);
}

export function editExerciseKeyboard(exercise: {
  id: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  workoutDayId: number;
  hasHistory: boolean;
  dayNumber: number;
}) {
  const id = exercise.id;
  const keyboard = new InlineKeyboard()
    .text("Підходи ➖", `ep_sets_dec:${id}`)
    .text(`${exercise.targetSets}`, "ep_noop")
    .text("➕", `ep_sets_inc:${id}`)
    .row()
    .text("Повт. min ➖", `ep_repmin_dec:${id}`)
    .text(`${exercise.targetRepsMin}`, "ep_noop")
    .text("➕", `ep_repmin_inc:${id}`)
    .row()
    .text("Повт. max ➖", `ep_repmax_dec:${id}`)
    .text(`${exercise.targetRepsMax}`, "ep_noop")
    .text("➕", `ep_repmax_inc:${id}`)
    .row()
    .text("🔁 Перейменувати", `ep_rename:${id}`)
    .row();

  if (!exercise.hasHistory) {
    keyboard.text("🗑 Видалити вправу", `ep_del:${id}`).row();
  }

  keyboard.text("⬅️ До списку вправ", `ep_day:${exercise.dayNumber}`);
  return keyboard;
}
