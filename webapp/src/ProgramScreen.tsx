import { useCallback, useState } from "react";
import { api, ExerciseUpdate, ProgramDay, ProgramExercise } from "./api";
import { LoadState, Stepper, useLoad } from "./components";
import { fmtRest, fmtWeight, shortWeekday } from "./format";
import { confirmAction, haptic, useBackButton } from "./telegram";

function targetLabel(ex: ProgramExercise): string {
  if (ex.type === "time") return `${ex.targetSets} × ${ex.targetRepsMin} с`;
  const reps = ex.targetRepsMin === ex.targetRepsMax ? `${ex.targetRepsMin}` : `${ex.targetRepsMin}–${ex.targetRepsMax}`;
  return `${ex.targetSets} × ${reps}`;
}

export function ProgramScreen() {
  const { data, setData, error, reload } = useLoad(() => api.program());
  const [dayNumber, setDayNumber] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const closeEditor = useCallback(() => setEditingId(null), []);

  if (!data) return <LoadState error={error} onRetry={() => void reload()} />;

  const day: ProgramDay = data.days.find((d) => d.dayNumber === dayNumber) ?? data.days[0];
  const editing = day.exercises.find((e) => e.id === editingId) ?? null;

  async function run(fn: () => Promise<{ days: ProgramDay[] }>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      setData({ days: res.days });
    } catch (e) {
      haptic.warning();
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <ExerciseEditor
        key={editing.id}
        exercise={editing}
        isFirst={day.exercises[0]?.id === editing.id}
        isLast={day.exercises[day.exercises.length - 1]?.id === editing.id}
        busy={busy}
        error={actionError}
        onBack={closeEditor}
        onSave={(update) => run(() => api.updateExercise(editing.id, update)).then(() => haptic.success())}
        onMove={(direction) => run(() => api.moveExercise(editing.id, direction))}
        onRemove={async () => {
          const message = editing.hasHistory
            ? `Прибрати «${editing.name}» з програми? Історія і графіки залишаться.`
            : `Видалити «${editing.name}»?`;
          if (!(await confirmAction(message))) return;
          await run(() => api.removeExercise(editing.id));
          setEditingId(null);
        }}
      />
    );
  }

  const addExercise = async () => {
    const name = newName.trim();
    if (name.length < 2) {
      setActionError("Назва має бути від 2 символів");
      return;
    }
    await run(async () => {
      const res = await api.addExercise(day.dayNumber, name);
      setNewName("");
      setEditingId(res.createdId);
      return res;
    });
  };

  return (
    <div className="screen">
      <div className="header">
        <h1 className="title">Програма</h1>
        <div className="segmented" style={{ marginTop: 12 }}>
          {data.days.map((d) => (
            <button
              key={d.dayNumber}
              className={d.dayNumber === day.dayNumber ? "active" : ""}
              onClick={() => {
                haptic.tap();
                setDayNumber(d.dayNumber);
              }}
            >
              {shortWeekday(d.weekday)}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, fontWeight: 600 }}>{day.name}</div>
        <div className="muted small">{day.weekday} · {day.exercises.length} вправ</div>
      </div>

      <div className="list">
        {day.exercises.map((ex, index) => (
          <button key={ex.id} className="item item-head" onClick={() => setEditingId(ex.id)}>
            <span className="status">{index + 1}</span>
            <span className="grow">
              <span className="clamp">{ex.name}</span>
              <span className="muted tiny" style={{ display: "block", marginTop: 2 }}>
                {ex.type === "warmup" ? "без ваги" : targetLabel(ex)} · {fmtRest(ex.restSeconds)}
              </span>
            </span>
            {ex.workingWeight != null ? (
              <span className="small" style={{ textAlign: "right", flex: "none" }}>
                {fmtWeight(ex.workingWeight)} кг
                {ex.nextWeight != null && Math.abs(ex.nextWeight - ex.workingWeight) > 0.01 ? (
                  <span style={{ display: "block", color: "var(--success)" }} className="tiny">
                    → {fmtWeight(ex.nextWeight)}
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="add-row">
        <input
          type="text"
          placeholder="Нова вправа"
          value={newName}
          maxLength={100}
          onChange={(e) => {
            setNewName(e.target.value);
            setActionError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addExercise();
          }}
        />
        <button className="rest-btn" disabled={busy} onClick={() => void addExercise()}>
          Додати
        </button>
      </div>
      {actionError ? <div className="error">{actionError}</div> : null}
    </div>
  );
}

interface EditorProps {
  exercise: ProgramExercise;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (update: ExerciseUpdate) => Promise<void>;
  onMove: (direction: "up" | "down") => Promise<void>;
  onRemove: () => Promise<void>;
}

function ExerciseEditor({ exercise, isFirst, isLast, busy, error, onBack, onSave, onMove, onRemove }: EditorProps) {
  useBackButton(onBack);
  const [name, setName] = useState(exercise.name);
  const [sets, setSets] = useState(exercise.targetSets);
  const [repsMin, setRepsMin] = useState(exercise.targetRepsMin);
  const [repsMax, setRepsMax] = useState(exercise.targetRepsMax);
  const [rest, setRest] = useState(exercise.restSeconds);
  const [step, setStep] = useState(exercise.progressionStep);
  const [technique, setTechnique] = useState(exercise.technique ?? "");

  const isTime = exercise.type === "time";
  const isWarmup = exercise.type === "warmup";
  const dirty =
    name.trim() !== exercise.name ||
    sets !== exercise.targetSets ||
    repsMin !== exercise.targetRepsMin ||
    repsMax !== exercise.targetRepsMax ||
    rest !== exercise.restSeconds ||
    step !== exercise.progressionStep ||
    technique.trim() !== (exercise.technique ?? "");

  return (
    <div className="screen">
      <div className="header">
        <button className="link" style={{ marginTop: 0 }} onClick={onBack}>
          ‹ Програма
        </button>
        <input
          className="title-input"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="muted small">
          {exercise.muscleGroup}
          {exercise.workingWeight != null ? ` · робоча вага ${fmtWeight(exercise.workingWeight)} кг` : ""}
        </div>
      </div>

      <div className="field-grid">
        <label>
          <span className="muted tiny">Підходи</span>
          <Stepper value={sets} step={1} min={1} max={10} unit="підх." onChange={setSets} />
        </label>
        <label>
          <span className="muted tiny">Відпочинок</span>
          <Stepper value={rest} step={15} min={0} max={600} unit="сек" onChange={setRest} />
        </label>
        <label>
          <span className="muted tiny">{isTime ? "Тривалість" : "Повтори від"}</span>
          <Stepper
            value={repsMin}
            step={isTime ? 5 : 1}
            min={1}
            max={600}
            unit={isTime ? "сек" : "повт"}
            onChange={(v) => {
              setRepsMin(v);
              if (v > repsMax) setRepsMax(v);
            }}
          />
        </label>
        <label>
          <span className="muted tiny">{isTime ? "Тривалість до" : "Повтори до"}</span>
          <Stepper
            value={repsMax}
            step={isTime ? 5 : 1}
            min={1}
            max={600}
            unit={isTime ? "сек" : "повт"}
            onChange={(v) => {
              setRepsMax(v);
              if (v < repsMin) setRepsMin(v);
            }}
          />
        </label>
        {!isWarmup ? (
          <label>
            <span className="muted tiny">
              Крок прогресії{exercise.progressionMode === "assist" ? " (противага)" : ""}
            </span>
            <Stepper value={step} step={0.5} min={0.5} max={50} unit="кг" onChange={setStep} />
          </label>
        ) : null}
      </div>

      <div className="muted tiny" style={{ marginTop: 14 }}>
        Техніка
      </div>
      <textarea
        className="textarea"
        rows={4}
        maxLength={1000}
        value={technique}
        placeholder="Підказки щодо виконання"
        onChange={(e) => setTechnique(e.target.value)}
      />

      {error ? <div className="error">{error}</div> : null}

      <button
        className="btn primary"
        disabled={busy || !dirty}
        onClick={() =>
          void onSave({
            name: name.trim(),
            targetSets: sets,
            targetRepsMin: repsMin,
            targetRepsMax: repsMax,
            restSeconds: rest,
            progressionStep: step,
            technique: technique.trim(),
          })
        }
      >
        {dirty ? "Зберегти" : "Збережено"}
      </button>

      <div className="btn-row">
        <button className="btn secondary" disabled={busy || isFirst} onClick={() => void onMove("up")}>
          ↑ Вище
        </button>
        <button className="btn secondary" disabled={busy || isLast} onClick={() => void onMove("down")}>
          ↓ Нижче
        </button>
      </div>

      <button className="btn danger-text" disabled={busy} onClick={() => void onRemove()}>
        {exercise.hasHistory ? "Прибрати з програми" : "Видалити вправу"}
      </button>
    </div>
  );
}
