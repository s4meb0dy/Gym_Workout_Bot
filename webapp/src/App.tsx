import { useCallback, useEffect, useState } from "react";
import { api, DayView, Summary, WorkoutView } from "./api";
import { DaysScreen } from "./DaysScreen";
import { SummaryScreen } from "./SummaryScreen";
import { WorkoutScreen } from "./WorkoutScreen";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "days"; days: DayView[]; firstName: string | null }
  | { kind: "workout"; workout: WorkoutView }
  | { kind: "summary"; summary: Summary };

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const data = await api.state();
      setState(
        data.workout
          ? { kind: "workout", workout: data.workout }
          : { kind: "days", days: data.days, firstName: data.firstName },
      );
    } catch (error) {
      setState({ kind: "error", message: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  switch (state.kind) {
    case "loading":
      return <div className="center muted">Завантаження…</div>;
    case "error":
      return (
        <div className="center">
          <div>{state.message}</div>
          <button className="link" onClick={() => void load()}>
            Спробувати ще раз
          </button>
        </div>
      );
    case "days":
      return (
        <DaysScreen
          days={state.days}
          firstName={state.firstName}
          onStarted={(workout) => setState({ kind: "workout", workout })}
        />
      );
    case "workout":
      return (
        <WorkoutScreen
          initial={state.workout}
          onFinished={(summary) => setState({ kind: "summary", summary })}
          onCancelled={() => void load()}
        />
      );
    case "summary":
      return <SummaryScreen summary={state.summary} onDone={() => void load()} />;
  }
}
