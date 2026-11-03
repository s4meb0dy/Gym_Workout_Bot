import { useState } from "react";
import { api, DayView, WorkoutView } from "./api";
import { daysAgo, shortWeekday } from "./format";
import { haptic } from "./telegram";

interface Props {
  days: DayView[];
  firstName: string | null;
  deloadAdvice: string | null;
  onStarted: (workout: WorkoutView) => void;
}

export function DaysScreen({ days, firstName, deloadAdvice, onStarted }: Props) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(dayNumber: number) {
    if (busy) return;
    haptic.impact();
    setBusy(dayNumber);
    setError(null);
    try {
      const { workout } = await api.start(dayNumber);
      onStarted(workout);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="screen">
      <div className="header">
        <div className="muted small">Привіт{firstName ? `, ${firstName}` : ""}</div>
        <h1 className="title">Обери тренування</h1>
      </div>

      {deloadAdvice ? <div className="note warn">🧘 {deloadAdvice}</div> : null}

      {days.map((day) => (
        <button
          key={day.dayNumber}
          className={`day-card${day.isToday ? " today" : ""}`}
          onClick={() => void start(day.dayNumber)}
          disabled={busy != null}
        >
          <div className="day-num">{shortWeekday(day.weekday)}</div>
          <div className="grow">
            <div className="row">
              <span className="ellipsis" style={{ fontWeight: 600 }}>
                {day.name}
              </span>
            </div>
            <div className="muted small">
              {day.exerciseCount} вправ · останнє: {daysAgo(day.lastCompletedAt)}
            </div>
          </div>
          {day.isToday ? <span className="badge up">Сьогодні</span> : null}
          {busy === day.dayNumber ? <span className="muted small">…</span> : null}
        </button>
      ))}

      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
