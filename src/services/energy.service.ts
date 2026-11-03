import { prisma } from "../db/client";
import { localDateString } from "./tracking.service";

/** Енергетична цінність 1 кг маси тіла (суміш жиру й м'язів), ккал. */
const KCAL_PER_KG = 7700;
/** День вважається записаним, якщо за нього внесено хоча б стільки ккал (інакше — недозапис). */
const MIN_LOGGED_KCAL = 1000;

export type Goal = "lean_bulk" | "maintain" | "cut";

export const GOAL_LABELS: Record<Goal, string> = {
  lean_bulk: "набір м'язів без жиру",
  maintain: "підтримка ваги",
  cut: "сушка",
};

/**
 * Бажаний темп зміни ваги, % від маси тіла за тиждень. Для чистого набору —
 * ~0.15–0.35%/тиждень (≈0.5–1 кг/місяць при 70 кг): швидше вже йде переважно жир.
 */
const GOAL_PACE: Record<Goal, { min: number; target: number; max: number }> = {
  lean_bulk: { min: 0.15, target: 0.25, max: 0.35 },
  maintain: { min: -0.1, target: 0, max: 0.1 },
  cut: { min: -0.75, target: -0.5, max: -0.3 },
};

export function parseGoal(value: unknown): Goal {
  return value === "maintain" || value === "cut" ? value : "lean_bulk";
}

export interface EnergyEstimate {
  /** Норма підтримки (TDEE) за фактичними даними, ккал. */
  tdee: number;
  avgIntake: number;
  weeklyChangeKg: number;
  latestWeightKg: number;
  periodDays: number;
  loggedDays: number;
  weighIns: number;
  confidence: "high" | "medium" | "low";
  goal: Goal;
  targetWeeklyChangeKg: number;
  /** Рекомендована ціль калорій під мету, округлена до 50. */
  recommendedCalories: number;
  pace: "below" | "on_track" | "above";
}

export interface EnergyMissing {
  missing: true;
  goal: Goal;
  weighIns: number;
  loggedDays: number;
  hint: string;
}

const DAY_MS = 86400000;

function slopePerDay(points: Array<{ t: number; w: number }>): number {
  const n = points.length;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanW = points.reduce((s, p) => s + p.w, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.w - meanW);
    den += (p.t - meanT) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

async function avgIntake(userId: string, from: Date, to: Date) {
  const fromDate = localDateString(from);
  const toDate = localDateString(to);
  const days = await prisma.nutritionLog.groupBy({
    by: ["date"],
    where: { userId, date: { gte: fromDate, lte: toDate } },
    _sum: { calories: true },
  });
  const logged = days.map((d) => d._sum.calories ?? 0).filter((kcal) => kcal >= MIN_LOGGED_KCAL);
  const avg = logged.length ? logged.reduce((s, k) => s + k, 0) / logged.length : 0;
  return { avg, loggedDays: logged.length };
}

/**
 * Адаптивна оцінка норми калорій (як у MacroFactor, спрощено): реальний тренд ваги
 * плюс фактично з'їдене. Якщо вага за період росте на X кг/день, то споживання
 * перевищує витрати на X × 7700 ккал/день: TDEE = середнє споживання − X × 7700.
 */
export async function estimateEnergy(userId: string): Promise<EnergyEstimate | EnergyMissing> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const goal = parseGoal(user?.goal);
  const now = new Date();

  const weights = await prisma.bodyWeight.findMany({
    where: { userId, recordedAt: { gte: new Date(now.getTime() - 200 * DAY_MS) } },
    orderBy: { recordedAt: "asc" },
  });

  // Точний режим: регресія по зважуваннях за останні 4 тижні.
  const recent = weights.filter((w) => w.recordedAt.getTime() >= now.getTime() - 28 * DAY_MS);
  const recentSpan =
    recent.length >= 2 ? (recent[recent.length - 1].recordedAt.getTime() - recent[0].recordedAt.getTime()) / DAY_MS : 0;

  let slope: number;
  let from: Date;
  let confidence: EnergyEstimate["confidence"];
  let weighIns: number;

  if (recent.length >= 4 && recentSpan >= 14) {
    slope = slopePerDay(recent.map((w) => ({ t: w.recordedAt.getTime() / DAY_MS, w: w.weightKg })));
    from = recent[0].recordedAt;
    weighIns = recent.length;
    confidence = recent.length >= 10 ? "high" : "medium";
  } else if (weights.length >= 2) {
    // Грубий режим: дві найвіддаленіші точки за ~півроку.
    const first = weights[0];
    const last = weights[weights.length - 1];
    const span = (last.recordedAt.getTime() - first.recordedAt.getTime()) / DAY_MS;
    if (span < 21) {
      return {
        missing: true,
        goal,
        weighIns: recent.length,
        loggedDays: 0,
        hint: "Зважуйся щоранку натще — після 4 зважувань за 2 тижні з'явиться точний розрахунок.",
      };
    }
    slope = (last.weightKg - first.weightKg) / span;
    from = first.recordedAt;
    weighIns = weights.length;
    confidence = "low";
  } else {
    return {
      missing: true,
      goal,
      weighIns: weights.length,
      loggedDays: 0,
      hint: "Потрібні зважування: записуй вагу щоранку натще — після 4 зважувань за 2 тижні з'явиться розрахунок.",
    };
  }

  const latestWeightKg = weights[weights.length - 1].weightKg;
  const { avg, loggedDays } = await avgIntake(userId, from, now);
  if (loggedDays < 7) {
    return {
      missing: true,
      goal,
      weighIns,
      loggedDays,
      hint: `За цей період записано їжу лише за ${loggedDays} дн. — потрібно щонайменше 7 повних днів.`,
    };
  }

  const tdee = avg - slope * KCAL_PER_KG;
  const pace = GOAL_PACE[goal];
  const targetWeeklyChangeKg = (latestWeightKg * pace.target) / 100;
  const surplus = (targetWeeklyChangeKg / 7) * KCAL_PER_KG;
  const weeklyChangeKg = slope * 7;
  const weeklyPct = (weeklyChangeKg / latestWeightKg) * 100;

  return {
    tdee: Math.round(tdee / 10) * 10,
    avgIntake: Math.round(avg),
    weeklyChangeKg: Math.round(weeklyChangeKg * 100) / 100,
    latestWeightKg,
    periodDays: Math.round((now.getTime() - from.getTime()) / DAY_MS),
    loggedDays,
    weighIns,
    confidence,
    goal,
    targetWeeklyChangeKg: Math.round(targetWeeklyChangeKg * 100) / 100,
    recommendedCalories: Math.round((tdee + surplus) / 50) * 50,
    pace: weeklyPct < pace.min ? "below" : weeklyPct > pace.max ? "above" : "on_track",
  };
}

export interface MacroSplit {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

/**
 * Розподіл БЖВ під калорії. Білок і жири рахуються від ваги (білок — головне для
 * м'язів, жири — для гормонів), а решта калорій іде у вуглеводи як паливо для тренувань.
 * Для чистого набору: білок 2.2 г/кг, жири ~0.9 г/кг, але не менше 20% калорій.
 */
export function macroSplit(calories: number, weightKg: number, goal: Goal): MacroSplit {
  const proteinPerKg = goal === "cut" ? 2.4 : 2.2;
  const protein = Math.round((weightKg * proteinPerKg) / 5) * 5;
  const fat = Math.round(Math.max(weightKg * 0.9, (calories * 0.2) / 9) / 5) * 5;
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4 / 5) * 5);
  return { calories, protein, fat, carbs };
}

/** Короткий висновок українською — для бота, порад і застосунку. */
export function describeEnergy(e: EnergyEstimate | EnergyMissing): string {
  if ("missing" in e) return e.hint;
  const sign = e.weeklyChangeKg > 0 ? "+" : "";
  const paceText =
    e.pace === "on_track"
      ? "темп відповідає меті"
      : e.pace === "below"
        ? e.goal === "lean_bulk"
          ? "вага росте повільніше, ніж треба для набору"
          : "вага змінюється повільніше за ціль"
        : e.goal === "lean_bulk"
          ? "вага росте швидше, ніж треба — зайве піде в жир"
          : "вага змінюється швидше за ціль";
  return (
    `Норма підтримки ≈ ${e.tdee} ккал (середнє з'їдене ${e.avgIntake} ккал, вага ${sign}${e.weeklyChangeKg} кг/тиждень — ${paceText}). ` +
    `Для мети «${GOAL_LABELS[e.goal]}» ціль ≈ ${e.recommendedCalories} ккал/день.`
  );
}

/** Чи було зважування сьогодні (за місцевим часом) — для ранкового нагадування. */
export async function hasWeighedToday(userId: string): Promise<boolean> {
  const last = await prisma.bodyWeight.findFirst({ where: { userId }, orderBy: { recordedAt: "desc" } });
  return last != null && localDateString(last.recordedAt) === localDateString();
}
