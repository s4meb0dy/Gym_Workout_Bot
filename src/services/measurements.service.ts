import { prisma } from "../db/client";

export const MEASUREMENT_FIELDS = ["waistCm", "chestCm", "shouldersCm", "armCm", "thighCm"] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];
export type MeasurementInput = Partial<Record<MeasurementField, number>>;

/** Заміри раз на 2 тижні: частіше — шум, рідше — пізно помітимо, що росте талія. */
export const MEASURE_EVERY_DAYS = 14;
const DAY_MS = 86400000;

interface Point {
  date: Date;
  value: number;
}

function nearest(points: Point[], date: Date): Point | undefined {
  return points.reduce<Point | undefined>(
    (best, p) =>
      !best || Math.abs(p.date.getTime() - date.getTime()) < Math.abs(best.date.getTime() - date.getTime()) ? p : best,
    undefined,
  );
}

/**
 * Головний сторож чистого набору — талія відносно ваги. Порівнюємо останній замір
 * з тим, що був ~4 тижні тому (або з першим): якщо вага росте, а талія майже ні —
 * росте м'язова маса; якщо талія росте так само швидко, як вага, — переважно жир.
 */
export function measurementInsight(waist: Point[], weights: Point[]): string | null {
  if (waist.length === 0) return null;
  if (waist.length === 1) return "Перший замір збережено — повтори через 2 тижні в тих самих умовах.";

  const latest = waist[waist.length - 1];
  const target = new Date(latest.date.getTime() - 28 * DAY_MS);
  const earlier = [...waist].reverse().find((p) => p.date <= target) ?? waist[0];
  const waistDelta = Math.round((latest.value - earlier.value) * 10) / 10;
  const days = Math.round((latest.date.getTime() - earlier.date.getTime()) / DAY_MS);

  const wNow = nearest(weights, latest.date);
  const wThen = nearest(weights, earlier.date);
  const fmt = (n: number) => `${n > 0 ? "+" : ""}${n}`;

  if (!wNow || !wThen || wNow === wThen) {
    return `Талія ${fmt(waistDelta)} см за ${days} дн. Зважуйся частіше — тоді буде видно, чи набір чистий.`;
  }

  const weightDelta = Math.round((wNow.value - wThen.value) * 10) / 10;
  const head = `За ${days} дн.: вага ${fmt(weightDelta)} кг, талія ${fmt(waistDelta)} см.`;

  if (weightDelta >= 0.5) {
    const ratio = waistDelta / weightDelta;
    if (ratio <= 0.5) return `${head} ✅ Чистий набір — росте переважно м'язова маса.`;
    if (ratio <= 1) return `${head} ⚠️ Талія росте помітно — тримай профіцит невеликим.`;
    return `${head} 🔴 Талія росте швидше за вагу — схоже, більше жиру, ніж м'язів. Зменш калорії на ~150.`;
  }
  if (weightDelta <= -0.5) {
    return `${head} Вага падає — для набору м'язів додай ~150–200 ккал.`;
  }
  if (waistDelta <= -0.5) return `${head} Талія меншає при стабільній вазі — рекомпозиція 👍`;
  return `${head} Вага стоїть — для набору трохи додай калорій.`;
}

export async function buildMeasurementsView(userId: string) {
  const [entries, weights] = await Promise.all([
    prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { recordedAt: "asc" }, take: 60 }),
    prisma.bodyWeight.findMany({ where: { userId }, orderBy: { recordedAt: "asc" } }),
  ]);

  const waist = entries
    .filter((e) => e.waistCm != null)
    .map((e) => ({ date: e.recordedAt, value: e.waistCm! }));
  const last = entries[entries.length - 1];
  const daysSinceLast = last ? Math.floor((Date.now() - last.recordedAt.getTime()) / DAY_MS) : null;

  return {
    entries: entries.map((e) => ({
      id: e.id,
      date: e.recordedAt,
      waistCm: e.waistCm,
      chestCm: e.chestCm,
      shouldersCm: e.shouldersCm,
      armCm: e.armCm,
      thighCm: e.thighCm,
    })),
    insight: measurementInsight(
      waist,
      weights.map((w) => ({ date: w.recordedAt, value: w.weightKg })),
    ),
    due: daysSinceLast == null || daysSinceLast >= MEASURE_EVERY_DAYS - 1,
    daysSinceLast,
  };
}

/** Лише розумні значення в сантиметрах; порожні поля пропускаються. */
export function parseMeasurement(body: unknown): MeasurementInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: MeasurementInput = {};
  for (const field of MEASUREMENT_FIELDS) {
    const raw = b[field];
    if (raw == null || raw === "" || raw === 0) continue;
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n) || n < 15 || n > 200) return null;
    out[field] = Math.round(n * 10) / 10;
  }
  return Object.keys(out).length > 0 ? out : null;
}
