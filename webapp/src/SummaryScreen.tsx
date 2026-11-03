import { Summary } from "./api";
import { fmtWeight } from "./format";

export function SummaryScreen({ summary, onDone }: { summary: Summary; onDone: () => void }) {
  return (
    <div className="screen">
      <div className="center" style={{ minHeight: "auto", paddingTop: 48 }}>
        <div className="status done" style={{ width: 56, height: 56, fontSize: 28 }}>
          ✓
        </div>
        <h1 className="title">Тренування завершено</h1>
        <div className="muted">{summary.dayName}</div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-value">{summary.durationMinutes}</div>
          <div className="muted tiny">хвилин</div>
        </div>
        <div className="stat">
          <div className="stat-value">{summary.totalSets}</div>
          <div className="muted tiny">підходів</div>
        </div>
        <div className="stat">
          <div className="stat-value">{Math.round(summary.tonnage).toLocaleString("uk-UA")}</div>
          <div className="muted tiny">кг тоннаж</div>
        </div>
      </div>

      {summary.records.length > 0 ? (
        <>
          <div className="muted small" style={{ margin: "20px 0 8px" }}>
            Нові рекорди
          </div>
          <div className="list">
            {summary.records.map((r) => (
              <div className="item row spread" key={r.exerciseName}>
                <span className="grow">
                  <span className="ellipsis" style={{ display: "block" }}>{r.exerciseName}</span>
                  {r.note ? <span className="muted tiny">{r.note}</span> : null}
                </span>
                <span className="badge up">
                  {fmtWeight(r.weight)} кг × {r.reps}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="note" style={{ marginTop: 16 }}>
          Сьогодні без нових рекордів — але тренування зараховано.
        </div>
      )}

      <button className="btn primary" style={{ marginTop: 24 }} onClick={onDone}>
        Готово
      </button>
    </div>
  );
}
