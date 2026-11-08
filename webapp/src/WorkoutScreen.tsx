import { useEffect, useState } from "react";
import { api, ExerciseView, SetView, Summary, WorkoutView } from "./api";
import { Stepper } from "./components";
import { fmtClock, fmtReps, fmtSets, fmtSetWeight, fmtTarget, fmtWeight, isBodyweight, isDone, unitLabel } from "./format";
import { confirmAction, haptic } from "./telegram";

interface Props {
  initial: WorkoutView;
  onFinished: (summary: Summary) => void;
  onCancelled: () => void;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Наступна невиконана вправа після `afterId` (по колу), інакше перша невиконана. */
function nextIncomplete(exercises: ExerciseView[], afterId?: number): ExerciseView | undefined {
  const start = afterId == null ? 0 : exercises.findIndex((e) => e.id === afterId) + 1;
  const ordered = [...exercises.slice(start), ...exercises.slice(0, start)];
  return ordered.find((e) => !isDone(e));
}

function defaultInputs(ex: ExerciseView): { weight: number; reps: number } {
  const last = ex.sets[ex.sets.length - 1];
  if (last) return { weight: last.weight, reps: last.reps };
  if (ex.type === "time") return { weight: ex.suggestedWeight, reps: ex.targetRepsMin };
  const lastReps = ex.lastSets[ex.lastSets.length - 1]?.reps;
  return {
    weight: ex.suggestedWeight,
    reps: ex.shouldIncrease || !lastReps ? ex.targetRepsMin : lastReps,
  };
}

export function WorkoutScreen({ initial, onFinished, onCancelled }: Props) {
  const [workout, setWorkout] = useState(initial);
  const [currentId, setCurrentId] = useState<number | null>(() => nextIncomplete(initial.exercises)?.id ?? null);
  const [weight, setWeight] = useState(0);
  const [reps, setReps] = useState(0);
  const [edit, setEdit] = useState<{ set: SetView; weight: number; reps: number } | null>(null);
  // Rest-pause: скільки повторень дотиснуто після паузи до останнього підходу.
  const [extra, setExtra] = useState<{ setId: string; reps: number } | null>(null);
  const restKey = `rest:${initial.sessionId}`;
  // Таймер відпочинку переживає перезавантаження застосунку (localStorage може бути недоступний).
  const [rest, setRestState] = useState<{ endsAt: number; total: number } | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(restKey) ?? "null") as { endsAt: number; total: number } | null;
      return saved && saved.endsAt > Date.now() ? saved : null;
    } catch {
      return null;
    }
  });
  const setRest = (value: { endsAt: number; total: number } | null) => {
    setRestState(value);
    try {
      if (value) localStorage.setItem(restKey, JSON.stringify(value));
      else localStorage.removeItem(restKey);
    } catch {
      // без збереження — таймер просто не переживе перезавантаження
    }
  };
  const [showTechnique, setShowTechnique] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<string | null>(null);
  const now = useNow(rest ? 250 : 1000);

  useEffect(() => {
    if (!record) return;
    const id = setTimeout(() => setRecord(null), 6000);
    return () => clearTimeout(id);
  }, [record]);

  const current = workout.exercises.find((e) => e.id === currentId) ?? null;

  useEffect(() => {
    setEdit(null);
    setExtra(null);
    setShowTechnique(false);
    if (current) {
      const d = defaultInputs(current);
      setWeight(d.weight);
      setReps(d.reps);
    }
    // Значення за замовчуванням ставимо лише при зміні вправи, а не після кожного підходу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  useEffect(() => {
    if (rest && now >= rest.endsAt) {
      haptic.success();
      setRest(null);
    }
  }, [now, rest]);

  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      haptic.warning();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function select(ex: ExerciseView) {
    if (ex.id === currentId) return;
    haptic.tap();
    setCurrentId(ex.id);
  }

  const logSet = () =>
    act(async () => {
      if (!current) return;
      const isWarmup = current.type === "warmup";
      const w = isWarmup ? 0 : weight;
      const r = isWarmup ? Math.max(1, current.targetRepsMax) : Math.round(reps);
      if (!isWarmup && (w <= 0 || r <= 0)) {
        setError("Вкажи вагу і кількість повторень");
        return;
      }

      const res = await api.logSet(current.id, w, r);
      haptic.success();
      if (res.record) setRecord(res.record);
      setWorkout(res.workout);
      if (res.restSeconds > 0) {
        setRest({ endsAt: Date.now() + res.restSeconds * 1000, total: res.restSeconds });
      }

      const updated = res.workout.exercises.find((e) => e.id === current.id);
      if (updated && isDone(updated)) {
        setCurrentId(nextIncomplete(res.workout.exercises, current.id)?.id ?? null);
      }
    });

  const saveEdit = () =>
    act(async () => {
      if (!edit) return;
      const res = await api.updateSet(edit.set.id, edit.weight, Math.round(edit.reps));
      haptic.success();
      setWorkout(res.workout);
      setEdit(null);
    });

  const deleteEdit = () =>
    act(async () => {
      if (!edit || !(await confirmAction(`Видалити підхід ${fmtWeight(edit.set.weight)}×${edit.set.reps}?`))) return;
      const res = await api.deleteSet(edit.set.id);
      setWorkout(res.workout);
      setEdit(null);
    });

  const saveExtra = () =>
    act(async () => {
      if (!extra) return;
      const res = await api.setExtraReps(extra.setId, Math.max(0, Math.round(extra.reps)));
      haptic.success();
      setWorkout(res.workout);
      setExtra(null);
      if (res.restSeconds > 0) {
        setRest({ endsAt: Date.now() + res.restSeconds * 1000, total: res.restSeconds });
      }
    });

  const skipRest = () => {
    setRest(null);
    void api.cancelRest().catch(() => undefined);
  };

  const finish = () =>
    act(async () => {
      const left = workout.exercises.filter((e) => !isDone(e)).length;
      const question =
        left > 0 ? `Завершити тренування? Не виконано вправ: ${left}.` : "Завершити тренування?";
      if (!(await confirmAction(question))) return;
      const { summary } = await api.finish();
      haptic.success();
      onFinished(summary);
    });

  const cancel = () =>
    act(async () => {
      if (!(await confirmAction("Скасувати тренування? Усі підходи цієї сесії буде видалено."))) return;
      await api.cancel();
      onCancelled();
    });

  const doneCount = workout.exercises.filter(isDone).length;
  const total = workout.exercises.length;
  const elapsed = (now - new Date(workout.startedAt).getTime()) / 1000;

  return (
    <div className="screen">
      <div className="header">
        <div className="row spread">
          <h1 className="title ellipsis grow">{workout.day.name}</h1>
          {elapsed < 6 * 3600 ? (
            <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtClock(elapsed)}
            </span>
          ) : (
            <span className="muted small">з {new Date(workout.startedAt).toLocaleDateString("uk-UA")}</span>
          )}
        </div>
        <div className="progress">
          <div style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          {doneCount} / {total} вправ
        </div>
      </div>

      {record ? (
        <button className="record-banner" onClick={() => setRecord(null)}>
          🏆 {record}
        </button>
      ) : null}

      <div className="list">
        {workout.exercises.map((ex, index) => {
          const isCurrent = ex.id === currentId;
          const done = isDone(ex);
          const statusClass = isCurrent ? "current" : done ? "done" : ex.sets.length > 0 ? "partial" : "";
          const statusText = done && !isCurrent ? "✓" : ex.sets.length > 0 ? `${ex.sets.length}/${ex.targetSets}` : index + 1;

          return (
            <div key={ex.id} className={`item${isCurrent ? " current" : ""}${done ? " done" : ""}`}>
              <button className="item-head" onClick={() => select(ex)}>
                <span className={`status ${statusClass}`}>{statusText}</span>
                <span className="grow">
                  <span className={`name ${isCurrent ? "" : "clamp"}`} style={{ display: "block", fontWeight: isCurrent ? 600 : 400 }}>
                    {ex.name}
                  </span>
                  {!isCurrent && done && ex.type !== "warmup" ? (
                    <span className="muted tiny ellipsis" style={{ display: "block" }}>
                      {fmtSets(ex.sets, ex.progressionMode)}
                    </span>
                  ) : null}
                </span>
                {!isCurrent ? <span className="muted small">{fmtTarget(ex)}</span> : null}
              </button>

              {isCurrent ? (
                <CurrentExercise
                  ex={ex}
                  weight={edit ? edit.weight : weight}
                  reps={edit ? edit.reps : reps}
                  onWeight={(v) => (edit ? setEdit({ ...edit, weight: v }) : setWeight(v))}
                  onReps={(v) => (edit ? setEdit({ ...edit, reps: v }) : setReps(v))}
                  editingId={edit?.set.id ?? null}
                  onEditSet={(set) => {
                    setExtra(null);
                    setEdit(edit?.set.id === set.id ? null : { set, weight: set.weight, reps: set.reps });
                  }}
                  extra={extra}
                  onExtraOpen={(set) => {
                    setEdit(null);
                    setExtra({ setId: set.id, reps: set.extraReps || 2 });
                  }}
                  onExtraReps={(v) => extra && setExtra({ ...extra, reps: v })}
                  onExtraSave={() => void saveExtra()}
                  onExtraCancel={() => setExtra(null)}
                  showTechnique={showTechnique}
                  onToggleTechnique={() => setShowTechnique((v) => !v)}
                  busy={busy}
                  onLog={() => void logSet()}
                  onSaveEdit={() => void saveEdit()}
                  onDeleteEdit={() => void deleteEdit()}
                  onCancelEdit={() => setEdit(null)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <div className="error">{error}</div> : null}

      <button className={`btn ${doneCount === total ? "success" : "secondary"}`} style={{ marginTop: 20 }} disabled={busy} onClick={() => void finish()}>
        Завершити тренування
      </button>
      <button className="btn danger-text" disabled={busy} onClick={() => void cancel()}>
        Скасувати тренування
      </button>

      {rest ? (
        <div className="restbar">
          <div className="restbar-inner">
            <div className="row spread">
              <div>
                <div className="muted tiny">Відпочинок</div>
                <div className="rest-time">{fmtClock((rest.endsAt - now) / 1000)}</div>
              </div>
              <button className="rest-btn" onClick={skipRest}>
                Пропустити
              </button>
            </div>
            <div className="progress" style={{ marginTop: 8 }}>
              <div style={{ width: `${Math.max(0, Math.min(100, ((rest.endsAt - now) / (rest.total * 1000)) * 100))}%` }} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface CurrentProps {
  ex: ExerciseView;
  weight: number;
  reps: number;
  onWeight: (v: number) => void;
  onReps: (v: number) => void;
  editingId: string | null;
  onEditSet: (set: SetView) => void;
  extra: { setId: string; reps: number } | null;
  onExtraOpen: (set: SetView) => void;
  onExtraReps: (v: number) => void;
  onExtraSave: () => void;
  onExtraCancel: () => void;
  showTechnique: boolean;
  onToggleTechnique: () => void;
  busy: boolean;
  onLog: () => void;
  onSaveEdit: () => void;
  onDeleteEdit: () => void;
  onCancelEdit: () => void;
}

function CurrentExercise(props: CurrentProps) {
  const { ex, editingId } = props;
  const done = isDone(ex);
  const isWarmup = ex.type === "warmup";
  const nextSet = Math.min(ex.sets.length + 1, ex.targetSets);
  const isAssist = ex.progressionMode === "assist";
  const lastSet = ex.sets[ex.sets.length - 1];

  return (
    <div style={{ paddingLeft: 38, marginTop: 6 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        <span className="small" style={{ color: "var(--accent-text)" }}>
          {done ? "Усі підходи виконано" : `Підхід ${nextSet} з ${ex.targetSets}`} · {fmtTarget(ex)}
        </span>
        {ex.shouldIncrease ? (
          <span className="badge up">
            {isAssist ? `−${fmtWeight(ex.progressionStep)} кг противаги` : `+${fmtWeight(ex.progressionStep)} кг`}
          </span>
        ) : null}
        {ex.stalledWeight != null ? <span className="badge warn">Застій</span> : null}
      </div>

      {ex.lastSets.length > 0 ? (
        <div className="muted small" style={{ marginTop: 6 }}>
          Минулого разу: {fmtSets(ex.lastSets, ex.progressionMode)}
        </div>
      ) : null}

      {ex.sets.length > 0 && !isWarmup ? (
        <div className="chips">
          {ex.sets.map((s) => (
            <button
              key={s.id}
              className={`chip today${editingId === s.id ? " editing" : ""}`}
              onClick={() => props.onEditSet(s)}
            >
              {fmtSetWeight(s.weight, ex.progressionMode)}×{fmtReps(s)}
            </button>
          ))}
        </div>
      ) : null}

      {lastSet && ex.type === "reps" && !editingId ? (
        props.extra ? (
          <div className="note">
            <div className="small" style={{ marginBottom: 8 }}>
              Дотиснув після паузи до підходу {lastSet.setNumber} ({fmtSetWeight(lastSet.weight, ex.progressionMode)}×{lastSet.reps}).
              У прогресію не йде — рахується лише основна частина.
            </div>
            <Stepper value={props.extra.reps} step={1} min={0} unit="повт. після паузи" onChange={props.onExtraReps} />
            <div className="btn-row">
              <button className="btn primary" disabled={props.busy} onClick={props.onExtraSave}>
                {props.extra.reps > 0 ? `Додати +${props.extra.reps}` : "Прибрати дотиск"}
              </button>
              <button className="btn secondary" disabled={props.busy} onClick={props.onExtraCancel}>
                Скасувати
              </button>
            </div>
          </div>
        ) : (
          <button className="link" onClick={() => props.onExtraOpen(lastSet)}>
            {lastSet.extraReps ? `Змінити дотиск (+${lastSet.extraReps})` : "+ Дотиснув після паузи"}
          </button>
        )
      ) : null}

      {ex.stalledWeight != null ? (
        <div className="note warn">
          {isBodyweight(ex.stalledWeight, ex.progressionMode) ? "Власна вага" : `${fmtWeight(ex.stalledWeight)} кг`} тримається кілька тренувань поспіль. Варіанти: deload −10%, інший діапазон
          повторень, або перевір сон і калорії.
        </div>
      ) : null}

      {ex.technique && isWarmup ? <div className="note">{ex.technique}</div> : null}
      {ex.technique && !isWarmup ? (
        <>
          <button className="link" onClick={props.onToggleTechnique}>
            {props.showTechnique ? "Сховати техніку" : "Техніка"}
          </button>
          {props.showTechnique ? <div className="note">{ex.technique}</div> : null}
        </>
      ) : null}

      {isWarmup ? (
        <button className="btn primary" disabled={props.busy} onClick={props.onLog}>
          {done ? "Ще раз" : ex.targetSets > 1 ? `Підхід ${nextSet} виконано` : "Виконано"}
        </button>
      ) : (
        <>
          <div className="steppers">
            <Stepper
              value={props.weight}
              step={ex.progressionStep}
              min={isAssist ? 1 : 0}
              unit={isAssist ? (isBodyweight(props.weight, "assist") ? "= власна вага" : "кг противаги") : "кг"}
              onChange={props.onWeight}
            />
            <Stepper value={props.reps} step={ex.type === "time" ? 5 : 1} unit={unitLabel(ex)} onChange={props.onReps} />
          </div>

          {editingId ? (
            <>
              <div className="btn-row">
                <button className="btn primary" disabled={props.busy} onClick={props.onSaveEdit}>
                  Зберегти
                </button>
                <button className="btn secondary" disabled={props.busy} onClick={props.onDeleteEdit}>
                  Видалити
                </button>
              </div>
              <button className="btn danger-text" style={{ color: "var(--muted)" }} onClick={props.onCancelEdit}>
                Скасувати редагування
              </button>
            </>
          ) : (
            <button className={`btn ${done ? "secondary" : "primary"}`} disabled={props.busy} onClick={props.onLog}>
              {done ? "Додатковий підхід" : `Записати підхід ${nextSet}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
