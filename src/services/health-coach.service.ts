import { generateGeminiText, isGeminiEnabled } from "./gemini.client";
import { HealthContext, formatSleep } from "./health.service";

const COACH_SYSTEM = `Ти — персональний коуч зі здоров'я та силових тренувань.
Користувач: чоловік ~182 см, ціль рекомпозиція ~75 кг, білок ~150 г/день, силовий спліт 4 дні/тиждень.
Давай короткі практичні поради українською (5–8 речень):
- сон, відновлення, пульс, HRV
- чи варто тренуватись сьогодні або зменшити інтенсивність
- білок, вода, активність
- коли лягати спати
Без медичних діагнозів. Якщо показники тривожні — порадь звернутись до лікаря.
Не використовуй markdown-заголовки, лише текст з емодзі для структури.`;

function ruleBasedAdvice(ctx: HealthContext): string {
  const tips: string[] = [];
  const sleep = ctx.metrics.sleepMinutes ?? 0;
  const hr = ctx.metrics.restingHr;
  const hrv = ctx.metrics.hrv;
  const steps = ctx.metrics.steps ?? 0;

  if (sleep > 0 && sleep < 360) {
    tips.push("😴 Сну менше 6 год — сьогодні краще легше навантаження або день відновлення.");
  } else if (sleep >= 420) {
    tips.push("😴 Сон добрий — можна тренуватись за планом.");
  }

  if (hr != null && hr > 70) {
    tips.push("❤️ Пульс спокою підвищений — перевір стрес, кофеїн і гідратацію.");
  } else if (hr != null && hr <= 60) {
    tips.push("❤️ Пульс спокою низький — добре для відновлення.");
  }

  if (hrv != null && hrv < 30) {
    tips.push("📉 HRV низький — організм ще відновлюється, не ганяйся за рекордами.");
  } else if (hrv != null && hrv >= 50) {
    tips.push("📈 HRV високий — гарний день для прогресії в залі.");
  }

  if (steps < 5000) {
    tips.push("👟 Мало кроків — 20–30 хв прогулянки після роботи допоможуть відновленню.");
  }

  if (ctx.proteinYesterday != null && ctx.proteinYesterday < ctx.proteinTarget * 0.8) {
    tips.push(`🍗 Вчора білка ${ctx.proteinYesterday}/${ctx.proteinTarget} г — сьогодні накрий ціль раніше.`);
  }

  if (sleep > 0 && sleep < 420) {
    tips.push("🌙 Спробуй лягти сьогодні на 30–45 хв раніше.");
  }

  if (tips.length === 0) {
    tips.push("✅ Показники в нормі — тримай режим: сон, білок, вода, тренування за планом.");
  }

  return tips.join("\n\n");
}

function buildCoachPrompt(ctx: HealthContext): string {
  return (
    `Дата: ${ctx.date}\n` +
    `Apple Watch / Health:\n` +
    `- Сон: ${formatSleep(ctx.metrics.sleepMinutes)}\n` +
    `- Пульс спокою: ${ctx.metrics.restingHr ?? "немає"} уд/хв\n` +
    `- HRV: ${ctx.metrics.hrv ?? "немає"} мс\n` +
    `- Кроки: ${ctx.metrics.steps ?? "немає"}\n` +
    `- Активні ккал: ${ctx.metrics.activeCalories ?? "немає"}\n` +
    `- Stand год: ${ctx.metrics.standHours ?? "немає"}\n` +
    `- Хв тренування: ${ctx.metrics.workoutMinutes ?? "немає"}\n\n` +
    `Контекст з бота:\n` +
    `- Вага: ${ctx.latestWeightKg ?? "немає"} кг\n` +
    `- Білок вчора: ${ctx.proteinYesterday ?? "немає"}/${ctx.proteinTarget} г\n` +
    `- Вода вчора: ${ctx.waterYesterdayMl ?? "немає"}/${ctx.waterTargetMl} мл\n` +
    `- Тренувань за тиждень: ${ctx.workoutsThisWeek}\n` +
    (ctx.lastWorkout
      ? `- Останнє тренування: ${ctx.lastWorkout.dayName} (${ctx.lastWorkout.date}), ${ctx.lastWorkout.sets} підходів\n`
      : "") +
    `\nДай персональні поради на сьогодні.`
  );
}

export async function generateHealthAdvice(ctx: HealthContext): Promise<string> {
  if (!isGeminiEnabled()) {
    return ruleBasedAdvice(ctx);
  }

  try {
    return await generateGeminiText(COACH_SYSTEM, buildCoachPrompt(ctx), { temperature: 0.5 });
  } catch (error) {
    console.error("Health coach Gemini failed:", error);
    return ruleBasedAdvice(ctx);
  }
}

export function buildShortcutInstructions(syncUrl: string, token: string): string {
  return (
    `📲 <b>Автосинхронізація з Apple Watch</b>\n\n` +
    `1. Відкрий додаток <b>Shortcuts</b> на iPhone\n` +
    `2. Створи новий Shortcut (або імпортуй нижче)\n` +
    `3. Додай дії Health:\n` +
    `   • Find Health Samples → Category: Sleep → Yesterday\n` +
    `   • Get Number of Heart Rate (Resting)\n` +
    `   • HRV (optional)\n` +
    `   • Steps → Today\n` +
    `   • Active Energy → Today\n` +
    `4. Додай <b>Get Contents of URL</b> (POST):\n` +
    `<code>${syncUrl}</code>\n\n` +
    `<b>Headers:</b> Content-Type: application/json\n\n` +
    `<b>Body (JSON):</b>\n` +
    `<code>{"token":"${token}","sleepMinutes":SLEEP,"restingHr":HR,"hrv":HRV,"steps":STEPS,"activeCalories":KCAL}</code>\n\n` +
    `5. Увімкни автomation «Кожен день о 8:00»\n\n` +
    `<i>Або вручну в боті:</i>\n` +
    `<code>/watch 7:30 58 42 8500</code>\n` +
    `(сон, пульс, hrv, кроки)`
  );
}
