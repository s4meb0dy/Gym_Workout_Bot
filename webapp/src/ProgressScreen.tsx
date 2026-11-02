import { useCallback, useState } from "react";
import { api } from "./api";
import { BarList, ColumnChart, LineChart } from "./charts";
import { LoadState, Section, useLoad } from "./components";
import { fmtDate, fmtNumber, fmtWeight } from "./format";
import { useBackButton } from "./telegram";

export function ProgressScreen() {
  const { data, error, reload } = useLoad(() => api.progress());
  const [exerciseId, setExerciseId] = useState<number | null>(null);
  const close = useCallback(() => setExerciseId(null), []);

  if (exerciseId != null) return <ExerciseProgressScreen id={exerciseId} onBack={close} />;
  if (!data) return <LoadState error={error} onRetry={() => void reload()} />;

  const thisWeek = data.weeks[data.weeks.length - 1];
  const last4 = data.weeks.slice(-4).reduce((n, w) => n + w.workouts, 0);

  return (
    <div className="screen">
      <div className="header">
        <h1 className="title">Прогрес</h1>
      </div>

      <div className="stats" style={{ marginTop: 0 }}>
        <div className="stat">
          <div className="stat-value">{thisWeek?.workouts ?? 0}</div>
          <div className="muted tiny">тренувань цього тижня</div>
        </div>
        <div className="stat">
          <div className="stat-value">{last4}</div>
          <div className="muted tiny">за 4 тижні</div>
        </div>
        <div className="stat">
          <div className="stat-value">{fmtNumber(thisWeek?.tonnage ?? 0)}</div>
          <div className="muted tiny">кг цього тижня</div>
        </div>
      </div>

      <Section title="Тоннаж по тижнях">
        <div className="list" style={{ padding: "12px 10px 8px" }}>
          <ColumnChart items={data.weeks.map((w) => ({ label: fmtDate(w.weekStart, { day: "numeric", month: "numeric" }), value: w.tonnage }))} />
        </div>
      </Section>

      <Section title="Підходи по м'язах · 7 днів">
        {data.volume.length > 0 ? (
          <BarList items={data.volume.map((v) => ({ label: v.muscleGroup, value: v.sets }))} unit="підх." />
        ) : (
          <div className="note">За останній тиждень тренувань не було.</div>
        )}
      </Section>

      <Section title="Вправи">
        {data.exercises.length > 0 ? (
          <div className="list">
            {data.exercises.map((e) => (
              <button key={e.exerciseId} className="item item-head" onClick={() => setExerciseId(e.exerciseId)}>
                <span className="grow clamp">{e.name}</span>
                <span className="muted small">{e.sessions} тр.</span>
                <span className="muted">›</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="note">Графіки з'являться після першого тренування.</div>
        )}
      </Section>
    </div>
  );
}

function ExerciseProgressScreen({ id, onBack }: { id: number; onBack: () => void }) {
  useBackButton(onBack);
  const { data, error, reload } = useLoad(() => api.exerciseProgress(id), [id]);

  if (!data) return <LoadState error={error} onRetry={() => void reload()} />;
  const points = data.points;
  const first = points[0];
  const last = points[points.length - 1];
  const best = points.reduce((b, p) => (p.oneRm > b.oneRm ? p : b), points[0]);
  const change = first && last ? last.oneRm - first.oneRm : 0;

  return (
    <div className="screen">
      <div className="header">
        <button className="link" style={{ marginTop: 0 }} onClick={onBack}>
          ‹ Прогрес
        </button>
        <h1 className="title" style={{ marginTop: 6 }}>
          {data.name}
        </h1>
        <div className="muted small">Оцінка 1ПМ (найкращий підхід тренування)</div>
      </div>

      {points.length === 0 ? (
        <div className="note">Ще немає записаних підходів з вагою.</div>
      ) : (
        <>
          <div className="stats" style={{ marginTop: 0 }}>
            <div className="stat">
              <div className="stat-value">{fmtWeight(last.oneRm)}</div>
              <div className="muted tiny">зараз, кг</div>
            </div>
            <div className="stat">
              <div className="stat-value" style={{ color: "var(--success)" }}>{fmtWeight(best.oneRm)}</div>
              <div className="muted tiny">рекорд, кг</div>
            </div>
            <div className="stat">
              <div className="stat-value" style={{ color: change >= 0 ? "var(--success)" : "var(--danger)" }}>
                {change >= 0 ? "+" : "−"}
                {fmtWeight(Math.abs(Math.round(change * 10) / 10))}
              </div>
              <div className="muted tiny">з першого разу</div>
            </div>
          </div>

          <div className="list" style={{ marginTop: 16, padding: "8px 6px 4px" }}>
            <LineChart points={points.map((p) => ({ label: fmtDate(p.date), value: p.oneRm }))} unit="кг" />
          </div>

          <Section title="Тренування">
            <div className="list">
              {[...points].reverse().map((p) => (
                <div key={p.date} className="item row spread small">
                  <span className="muted">{fmtDate(p.date, { day: "numeric", month: "short", year: "2-digit" })}</span>
                  <span>
                    {fmtWeight(p.bestWeight)} × {p.bestReps}
                  </span>
                  <span style={{ color: p === best ? "var(--success)" : undefined }}>{fmtWeight(p.oneRm)} кг</span>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
