import { useState } from "react";
import { api, DayData, FoodEntry, Goal, Macros } from "./api";
import { LineChart } from "./charts";
import { LoadState, Section, Stepper, useLoad } from "./components";
import { fmtDate, fmtNumber, fmtWeight } from "./format";
import { confirmAction, haptic } from "./telegram";

function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dayTitle(day: DayData): string {
  if (day.isToday) return "Сьогодні";
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000).toLocaleDateString("en-CA");
  if (day.date === yesterday) return "Вчора";
  return fmtDate(`${day.date}T12:00:00`, { weekday: "short", day: "numeric", month: "long" });
}

function fmtLiters(ml: number): string {
  return ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)} л` : `${ml} мл`;
}

function Bar({ value, target, over }: { value: number; target: number; over?: boolean }) {
  const ratio = target > 0 ? value / target : 0;
  const color = over && ratio > 1.05 ? "var(--warn)" : ratio >= 1 ? "var(--success)" : "var(--accent)";
  return (
    <div className="progress" style={{ marginTop: 6 }}>
      <div style={{ width: `${Math.min(100, ratio * 100)}%`, background: color }} />
    </div>
  );
}

export function DayScreen() {
  const [date, setDate] = useState<string | null>(null);
  const { data, setData, error, reload } = useLoad(() => api.day(date ?? undefined), [date]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!data) return <LoadState error={error} onRetry={() => void reload()} />;
  const day = data.day;

  async function run(fn: () => Promise<{ day: DayData }>, success = true) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      setData({ day: res.day });
      if (success) haptic.success();
    } catch (e) {
      haptic.warning();
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="header">
        <div className="row spread">
          <button className="nav-btn" aria-label="Попередній день" onClick={() => setDate(shiftDate(day.date, -1))}>
            ‹
          </button>
          <h1 className="title">{dayTitle(day)}</h1>
          <button
            className="nav-btn"
            aria-label="Наступний день"
            disabled={day.isToday}
            onClick={() => setDate(shiftDate(day.date, 1))}
          >
            ›
          </button>
        </div>
      </div>

      {actionError ? <div className="error">{actionError}</div> : null}

      <NutritionCard day={day} busy={busy} run={run} />
      <WaterCard day={day} busy={busy} run={run} />
      <WeightCard day={day} busy={busy} run={run} />
      <HealthCard day={day} />
      <TargetsCard day={day} busy={busy} run={run} />
    </div>
  );
}

type Run = (fn: () => Promise<{ day: DayData }>, success?: boolean) => Promise<void>;

interface CardProps {
  day: DayData;
  busy: boolean;
  run: Run;
}

const EMPTY_FOOD = { label: "", calories: 0, protein: 0, fat: 0, carbs: 0 };

function NutritionCard({ day, busy, run }: CardProps) {
  const [form, setForm] = useState<(Macros & { label: string; id?: string }) | null>(null);
  const { macros, targets } = day;
  const left = targets.calories - macros.calories;

  const edit = (entry: FoodEntry) => {
    haptic.tap();
    setForm(form?.id === entry.id ? null : { ...entry });
  };

  const save = async () => {
    if (!form) return;
    const { id, ...food } = form;
    await run(() => (id ? api.updateFood(id, food) : api.addFood(day.date, food)));
    setForm(null);
  };

  const remove = async () => {
    if (!form?.id || !(await confirmAction(`Видалити «${form.label}»?`))) return;
    const id = form.id;
    await run(() => api.deleteFood(id));
    setForm(null);
  };

  return (
    <Section title="Харчування">
      <div className="card">
        <div className="row spread" style={{ alignItems: "baseline" }}>
          <div>
            <span className="big-num">{fmtNumber(macros.calories)}</span>
            <span className="muted"> / {fmtNumber(targets.calories)} ккал</span>
          </div>
          <span className="small" style={{ color: left >= 0 ? "var(--muted)" : "var(--warn)" }}>
            {left >= 0 ? `ще ${fmtNumber(left)}` : `+${fmtNumber(-left)}`}
          </span>
        </div>
        <Bar value={macros.calories} target={targets.calories} over />

        <div className="row spread small" style={{ marginTop: 12 }}>
          <span>Білок</span>
          <span className="muted">
            {macros.protein} / {targets.protein} г
          </span>
        </div>
        <Bar value={macros.protein} target={targets.protein} />

        <div className="macro-bars">
          <div>
            <div className="row spread small">
              <span>Вуглеводи</span>
              <span className="muted">
                {macros.carbs} / {targets.carbs} г
              </span>
            </div>
            <Bar value={macros.carbs} target={targets.carbs} />
          </div>
          <div>
            <div className="row spread small">
              <span>Жири</span>
              <span className="muted">
                {macros.fat} / {targets.fat} г
              </span>
            </div>
            <Bar value={macros.fat} target={targets.fat} over />
          </div>
        </div>

        {day.recentFoods.length > 0 && !form ? (
          <div className="chips">
            {day.recentFoods.map((f) => (
              <button
                key={f.label}
                className="chip"
                disabled={busy}
                onClick={() => void run(() => api.addFood(day.date, f))}
              >
                + {f.label} · {f.calories}
              </button>
            ))}
          </div>
        ) : null}

        {day.previousEntries.length > 0 && !form ? (
          <YesterdayPanel day={day} busy={busy} run={run} />
        ) : null}

        {day.entries.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            {day.entries.map((e) => (
              <button key={e.id} className={`entry${form?.id === e.id ? " editing" : ""}`} onClick={() => edit(e)}>
                <span className="grow ellipsis">{e.label}</span>
                <span className="muted small">
                  {e.calories > 0 ? `${e.calories} ккал · ` : ""}Б {e.protein}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {form ? (
          <FoodForm
            value={form}
            busy={busy}
            onChange={setForm}
            onSave={() => void save()}
            onDelete={form.id ? () => void remove() : undefined}
            onCancel={() => setForm(null)}
          />
        ) : (
          <button className="btn secondary" onClick={() => setForm({ ...EMPTY_FOOD })}>
            + Додати їжу
          </button>
        )}
      </div>
    </Section>
  );
}

/** «Як учора»: записи попереднього дня — додати все разом або окремі. */
function YesterdayPanel({ day, busy, run }: CardProps) {
  const [open, setOpen] = useState(false);
  const prev = day.previousEntries;
  const total = prev.reduce((sum, e) => sum + e.calories, 0);

  if (!open) {
    return (
      <button className="link" onClick={() => setOpen(true)}>
        ↺ Як учора ({prev.length} записів · {fmtNumber(total)} ккал)
      </button>
    );
  }

  return (
    <div className="note" style={{ color: "var(--text)" }}>
      <div className="row spread">
        <span className="small muted">Попередній день</span>
        <button className="link" style={{ marginTop: 0 }} onClick={() => setOpen(false)}>
          Сховати
        </button>
      </div>
      {prev.map((e) => (
        <div key={e.id} className="entry" style={{ cursor: "default" }}>
          <span className="grow ellipsis">{e.label}</span>
          <span className="muted small">{e.calories > 0 ? `${e.calories} ккал` : `Б ${e.protein}`}</span>
          <button
            className="rest-btn"
            style={{ padding: "4px 10px" }}
            disabled={busy}
            onClick={() => void run(() => api.copyFoods(day.date, [e.id]))}
          >
            +
          </button>
        </div>
      ))}
      <button
        className="btn primary"
        style={{ height: 42, fontSize: 15 }}
        disabled={busy}
        onClick={async () => {
          await run(() => api.copyFoods(day.date, prev.map((e) => e.id)));
          setOpen(false);
        }}
      >
        Додати все ({fmtNumber(total)} ккал)
      </button>
    </div>
  );
}

interface FoodFormProps {
  value: Macros & { label: string; id?: string };
  busy: boolean;
  onChange: (value: Macros & { label: string; id?: string }) => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}

function FoodForm({ value, busy, onChange, onSave, onDelete, onCancel }: FoodFormProps) {
  const fields: Array<[keyof Macros, string]> = [
    ["calories", "Ккал"],
    ["protein", "Білки"],
    ["fat", "Жири"],
    ["carbs", "Вугл."],
  ];
  const valid = value.calories > 0 || value.protein > 0;

  return (
    <div style={{ marginTop: 12 }}>
      <input
        className="text-input"
        placeholder="Назва (напр. сирники)"
        value={value.label}
        maxLength={80}
        onChange={(e) => onChange({ ...value, label: e.target.value })}
      />
      <div className="macro-grid">
        {fields.map(([key, label]) => (
          <label key={key}>
            <span className="muted tiny">{label}</span>
            <input
              className="text-input center-text"
              type="number"
              inputMode="decimal"
              value={value[key] || ""}
              placeholder="0"
              onChange={(e) => onChange({ ...value, [key]: Math.max(0, Number(e.target.value.replace(",", ".")) || 0) })}
            />
          </label>
        ))}
      </div>
      <div className="btn-row">
        <button className="btn primary" disabled={busy || !valid} onClick={onSave}>
          {value.id ? "Зберегти" : "Додати"}
        </button>
        {onDelete ? (
          <button className="btn secondary" disabled={busy} onClick={onDelete}>
            Видалити
          </button>
        ) : null}
      </div>
      <button className="btn danger-text" style={{ color: "var(--muted)" }} onClick={onCancel}>
        Скасувати
      </button>
    </div>
  );
}

function WaterCard({ day, busy, run }: CardProps) {
  return (
    <Section title="Вода">
      <div className="card">
        <div className="row spread" style={{ alignItems: "baseline" }}>
          <div>
            <span className="big-num">{fmtLiters(day.waterMl)}</span>
            <span className="muted"> / {fmtLiters(day.targets.waterMl)}</span>
          </div>
          <button
            className="link"
            style={{ marginTop: 0 }}
            disabled={busy || day.waterMl === 0}
            onClick={() => void run(() => api.undoWater(day.date), false)}
          >
            ↩ Скасувати
          </button>
        </div>
        <Bar value={day.waterMl} target={day.targets.waterMl} />
        <div className="btn-row" style={{ marginTop: 4 }}>
          {[250, 500, 750].map((ml) => (
            <button key={ml} className="btn secondary" disabled={busy} onClick={() => void run(() => api.addWater(day.date, ml))}>
              +{ml}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function WeightCard({ day, busy, run }: CardProps) {
  const points = day.weight.points;
  const latest = points[points.length - 1];
  const [input, setInput] = useState<number>(latest?.weightKg ?? 75);

  const weekAgo = latest
    ? [...points].reverse().find((p) => new Date(latest.date).getTime() - new Date(p.date).getTime() >= 6 * 86400000)
    : undefined;
  const change = latest && weekAgo ? Math.round((latest.weightKg - weekAgo.weightKg) * 10) / 10 : null;

  return (
    <Section title="Вага тіла">
      <div className="card">
        {latest ? (
          <div className="row spread" style={{ alignItems: "baseline" }}>
            <div>
              <span className="big-num">{fmtWeight(latest.weightKg)}</span>
              <span className="muted"> кг · {fmtDate(latest.date)}</span>
            </div>
            {change != null ? (
              <span className="small muted">
                {change > 0 ? "+" : change < 0 ? "−" : "±"}
                {fmtWeight(Math.abs(change))} за тиждень
              </span>
            ) : null}
          </div>
        ) : (
          <div className="muted small">Записів ваги ще немає.</div>
        )}

        {points.length >= 2 ? (
          <div style={{ marginTop: 8 }}>
            <LineChart points={points.map((p) => ({ label: fmtDate(p.date), value: p.weightKg }))} unit="кг" />
          </div>
        ) : null}

        <EnergyBlock day={day} busy={busy} run={run} />

        <div className="row" style={{ marginTop: 10 }}>
          <div className="grow">
            <Stepper value={input} step={0.1} min={30} max={300} unit="кг" onChange={setInput} />
          </div>
          <button
            className="rest-btn"
            style={{ height: 60 }}
            disabled={busy}
            onClick={() => void run(() => api.logWeight(day.date, input))}
          >
            Записати
          </button>
        </div>
        {latest ? (
          <button
            className="link"
            disabled={busy}
            onClick={async () => {
              if (await confirmAction(`Видалити запис ${fmtWeight(latest.weightKg)} кг від ${fmtDate(latest.date)}?`)) {
                void run(() => api.deleteWeight(latest.id, day.date), false);
              }
            }}
          >
            Видалити останній запис
          </button>
        ) : null}
      </div>
    </Section>
  );
}

const GOAL_LABELS: Record<Goal, string> = {
  lean_bulk: "Набір без жиру",
  maintain: "Підтримка",
  cut: "Сушка",
};

/** Справжня норма калорій за трендом ваги й з'їденим + рекомендація під мету. */
function EnergyBlock({ day, busy, run }: CardProps) {
  const e = day.energy;
  if (e.missing) {
    return <div className="note">⚡ {e.hint}</div>;
  }

  const sign = e.weeklyChangeKg > 0 ? "+" : "";
  const paceColor = e.pace === "on_track" ? "var(--success)" : "var(--warn)";
  const paceText =
    e.pace === "on_track"
      ? "темп відповідає меті"
      : e.pace === "below"
        ? e.goal === "lean_bulk"
          ? "для набору замало"
          : "повільніше за ціль"
        : e.goal === "lean_bulk"
          ? "зашвидко — зайве піде в жир"
          : "швидше за ціль";
  const confidence = { high: "висока", medium: "середня", low: "низька" }[e.confidence];
  // На грубій оцінці (мало зважувань) ціль не змінюємо — легко помилитися на сотні ккал.
  const differs = e.confidence !== "low" && Math.abs(e.recommendedCalories - day.targets.calories) >= 50;

  return (
    <div className="note" style={{ color: "var(--text)" }}>
      <div className="row spread">
        <span className="small muted">Норма підтримки</span>
        <span className="tiny muted">точність: {confidence}</span>
      </div>
      <div className="big-num">≈ {fmtNumber(e.tdee)} ккал</div>
      <div className="small" style={{ marginTop: 4 }}>
        Вага <b style={{ color: paceColor }}>{sign}{fmtWeight(e.weeklyChangeKg)} кг/тиждень</b> — {paceText}
      </div>
      <div className="tiny muted" style={{ marginTop: 2 }}>
        За {e.periodDays} дн.: {e.weighIns} зважувань, їжа записана {e.loggedDays} дн., середнє {fmtNumber(e.avgIntake)} ккал
      </div>
      <div className="small" style={{ marginTop: 8 }}>
        {GOAL_LABELS[e.goal]} (~{e.targetWeeklyChangeKg > 0 ? "+" : ""}
        {fmtWeight(e.targetWeeklyChangeKg)} кг/тиждень): <b>{fmtNumber(e.recommendedCalories)} ккал/день</b>
      </div>
      {differs ? (
        <button
          className="btn secondary"
          style={{ height: 40, fontSize: 14, marginTop: 8 }}
          disabled={busy}
          onClick={() =>
            void run(() =>
              api.updateTargets(day.date, {
                calories: e.recommendedCalories,
                protein: day.targets.protein,
                waterMl: day.targets.waterMl,
              }),
            )
          }
        >
          Зробити ціллю {fmtNumber(e.recommendedCalories)} ккал (зараз {fmtNumber(day.targets.calories)})
        </button>
      ) : null}
      {e.confidence === "low" ? (
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Оцінка груба — зважуйся щоранку, і за 2 тижні вона стане точною.
        </div>
      ) : null}
    </div>
  );
}

function fmtSleep(minutes: number | null): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} г ${m} хв` : `${h} г`;
}

function HealthCard({ day }: { day: DayData }) {
  const [advice, setAdvice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const h = day.health;

  const metrics: Array<[string, string]> = h
    ? [
        ["Сон", fmtSleep(h.sleepMinutes)],
        ["Пульс спокою", h.restingHr ? `${h.restingHr}` : "—"],
        ["HRV", h.hrv ? `${Math.round(h.hrv)} мс` : "—"],
        ["Кроки", h.steps ? fmtNumber(h.steps) : "—"],
        ["Активні ккал", h.activeCalories ? fmtNumber(h.activeCalories) : "—"],
      ]
    : [];

  const loadAdvice = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.advice(day.date);
      setAdvice(res.advice ?? "Немає даних для порад.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="Здоров'я · годинник">
      <div className="card">
        {h ? (
          <div className="metric-grid">
            {metrics.map(([label, value]) => (
              <div key={label}>
                <div className="muted tiny">{label}</div>
                <div style={{ fontWeight: 600, fontSize: 17 }}>{value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted small">За цей день даних з годинника немає.</div>
        )}
        {h ? (
          <button className="btn secondary" disabled={loading} onClick={() => void loadAdvice()}>
            {loading ? "Аналізую…" : "Поради на день"}
          </button>
        ) : null}
        {error ? <div className="error">{error}</div> : null}
        {advice ? <div className="note">{advice}</div> : null}
      </div>
    </Section>
  );
}

function TargetsCard({ day, busy, run }: CardProps) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState<Goal>(day.profile.goal);
  const [height, setHeight] = useState(day.profile.heightCm ?? 180);
  const [weighIn, setWeighIn] = useState(day.profile.weighInReminder);
  const [calories, setCalories] = useState(day.targets.calories);
  const [protein, setProtein] = useState(day.targets.protein);
  const [fat, setFat] = useState(day.targets.fat);
  const [carbs, setCarbs] = useState(day.targets.carbs);
  const [water, setWater] = useState(day.targets.waterMl);

  const latestWeight = day.weight.points[day.weight.points.length - 1]?.weightKg ?? null;
  const macroKcal = Math.round(protein * 4 + fat * 9 + carbs * 4);

  // Та сама формула, що й на сервері (energy.service macroSplit): білок і жири від ваги, решта — вуглеводи.
  const applySplit = () => {
    if (!latestWeight) return;
    const p = Math.round((latestWeight * (goal === "cut" ? 2.4 : 2.2)) / 5) * 5;
    const f = Math.round(Math.max(latestWeight * 0.9, (calories * 0.2) / 9) / 5) * 5;
    setProtein(p);
    setFat(f);
    setCarbs(Math.max(0, Math.round((calories - p * 4 - f * 9) / 4 / 5) * 5));
    haptic.success();
  };

  if (!open) {
    return (
      <button className="link" style={{ marginTop: 20 }} onClick={() => setOpen(true)}>
        Профіль і цілі · {GOAL_LABELS[day.profile.goal].toLowerCase()}
      </button>
    );
  }

  return (
    <Section title="Профіль і цілі">
      <div className="card field-grid" style={{ gridTemplateColumns: "1fr" }}>
        <label>
          <span className="muted tiny">Мета</span>
          <div className="segmented">
            {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
              <button key={g} className={g === goal ? "active" : ""} onClick={() => setGoal(g)}>
                {GOAL_LABELS[g]}
              </button>
            ))}
          </div>
        </label>
        <label>
          <span className="muted tiny">Зріст</span>
          <Stepper value={height} step={1} min={120} max={230} unit="см" onChange={setHeight} />
        </label>
        <label>
          <span className="muted tiny">Калорії</span>
          <Stepper value={calories} step={50} min={800} max={6000} unit="ккал" onChange={setCalories} />
        </label>
        {latestWeight ? (
          <button className="btn secondary" style={{ height: 42, fontSize: 14, marginTop: 0 }} onClick={applySplit}>
            Розрахувати БЖВ під {fmtNumber(calories)} ккал і {fmtWeight(latestWeight)} кг
          </button>
        ) : null}
        <label>
          <span className="muted tiny">
            Білок{latestWeight ? ` · ${fmtWeight(Math.round((protein / latestWeight) * 10) / 10)} г/кг` : ""}
          </span>
          <Stepper value={protein} step={5} min={20} max={400} unit="г" onChange={setProtein} />
        </label>
        <label>
          <span className="muted tiny">Вуглеводи{latestWeight ? ` · ${fmtWeight(Math.round((carbs / latestWeight) * 10) / 10)} г/кг` : ""}</span>
          <Stepper value={carbs} step={5} min={0} max={1200} unit="г" onChange={setCarbs} />
        </label>
        <label>
          <span className="muted tiny">Жири{latestWeight ? ` · ${fmtWeight(Math.round((fat / latestWeight) * 10) / 10)} г/кг` : ""}</span>
          <Stepper value={fat} step={5} min={10} max={400} unit="г" onChange={setFat} />
        </label>
        <div className="tiny" style={{ color: Math.abs(macroKcal - calories) > 100 ? "var(--warn)" : "var(--muted)" }}>
          БЖВ разом: {fmtNumber(macroKcal)} ккал
          {Math.abs(macroKcal - calories) > 100 ? ` — не збігається з ціллю ${fmtNumber(calories)} ккал` : ""}
        </div>
        <label>
          <span className="muted tiny">Вода</span>
          <Stepper value={water} step={250} min={500} max={8000} unit="мл" onChange={setWater} />
        </label>
        <button className="entry" style={{ borderTop: "none" }} onClick={() => setWeighIn((v) => !v)}>
          <span className="grow">Нагадувати зважитись о {day.profile.weighInHour}:00</span>
          <span style={{ color: weighIn ? "var(--success)" : "var(--muted)" }}>{weighIn ? "Увімкнено" : "Вимкнено"}</span>
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            await run(() => api.updateProfile(day.date, { heightCm: Math.round(height), goal, weighInReminder: weighIn }), false);
            await run(() =>
              api.updateTargets(day.date, {
                calories: Math.round(calories),
                protein: Math.round(protein),
                fat: Math.round(fat),
                carbs: Math.round(carbs),
                waterMl: Math.round(water),
              }),
            );
            setOpen(false);
          }}
        >
          Зберегти
        </button>
      </div>
    </Section>
  );
}
