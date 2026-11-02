import { useCallback, useState } from "react";
import { api, HistoryItem } from "./api";
import { LoadState, useLoad } from "./components";
import { fmtDate, fmtNumber, fmtSets } from "./format";
import { useBackButton } from "./telegram";

function monthKey(iso: string): string {
  const label = new Date(iso).toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function HistoryScreen() {
  const { data, error, reload } = useLoad(() => api.history());
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);

  if (openId) return <HistoryDetailScreen id={openId} onBack={close} />;
  if (!data) return <LoadState error={error} onRetry={() => void reload()} />;

  const groups = new Map<string, HistoryItem[]>();
  for (const s of data.sessions) {
    const key = monthKey(s.completedAt);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return (
    <div className="screen">
      <div className="header">
        <h1 className="title">Історія</h1>
      </div>

      {data.sessions.length === 0 ? (
        <div className="note">Тут з'являться завершені тренування.</div>
      ) : (
        [...groups.entries()].map(([month, sessions]) => (
          <div key={month} style={{ marginBottom: 18 }}>
            <div className="muted small" style={{ marginBottom: 8 }}>
              {month}
            </div>
            <div className="list">
              {sessions.map((s) => (
                <button key={s.id} className="item item-head" onClick={() => setOpenId(s.id)}>
                  <div className="date-box">
                    <div style={{ fontWeight: 600, fontSize: 17, lineHeight: 1 }}>{new Date(s.completedAt).getDate()}</div>
                    <div className="muted tiny">{fmtDate(s.completedAt, { weekday: "short" })}</div>
                  </div>
                  <span className="grow">
                    <span className="clamp">{s.dayName}</span>
                    <span className="muted tiny" style={{ display: "block", marginTop: 2 }}>
                      {s.durationMinutes} хв · {s.sets} підх. · {fmtNumber(s.tonnage)} кг
                    </span>
                  </span>
                  <span className="muted">›</span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function HistoryDetailScreen({ id, onBack }: { id: string; onBack: () => void }) {
  useBackButton(onBack);
  const { data, error, reload } = useLoad(() => api.historyDetail(id), [id]);

  if (!data) return <LoadState error={error} onRetry={() => void reload()} />;
  const s = data.session;

  return (
    <div className="screen">
      <div className="header">
        <button className="link" style={{ marginTop: 0 }} onClick={onBack}>
          ‹ Історія
        </button>
        <h1 className="title" style={{ marginTop: 6 }}>
          {s.dayName}
        </h1>
        <div className="muted small">{fmtDate(s.completedAt, { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>

      <div className="stats" style={{ marginTop: 0 }}>
        <div className="stat">
          <div className="stat-value">{s.durationMinutes}</div>
          <div className="muted tiny">хвилин</div>
        </div>
        <div className="stat">
          <div className="stat-value">{s.exercises.reduce((n, e) => n + e.sets.length, 0)}</div>
          <div className="muted tiny">підходів</div>
        </div>
        <div className="stat">
          <div className="stat-value">{fmtNumber(s.tonnage)}</div>
          <div className="muted tiny">кг тоннаж</div>
        </div>
      </div>

      <div className="list" style={{ marginTop: 16 }}>
        {s.exercises.map((e) => (
          <div key={e.exerciseId} className="item">
            <div>{e.name}</div>
            <div className="chips" style={{ marginTop: 6 }}>
              {e.sets.map((set, i) => (
                <span key={i} className="chip">
                  {fmtSets([set])}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
