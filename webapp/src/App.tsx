import { useCallback, useEffect, useState } from "react";
import { api, DayView, Summary, WorkoutView } from "./api";
import { LoadState, Tab, TabBar } from "./components";
import { DayScreen } from "./DayScreen";
import { DaysScreen } from "./DaysScreen";
import { HistoryScreen } from "./HistoryScreen";
import { ProgramScreen } from "./ProgramScreen";
import { ProgressScreen } from "./ProgressScreen";
import { SummaryScreen } from "./SummaryScreen";
import { WorkoutScreen } from "./WorkoutScreen";

type WorkoutState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "days"; days: DayView[]; firstName: string | null; deloadAdvice: string | null }
  | { kind: "workout"; workout: WorkoutView }
  | { kind: "summary"; summary: Summary };

function WorkoutTab({ visible }: { visible: boolean }) {
  const [state, setState] = useState<WorkoutState>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const data = await api.state();
      setState(
        data.workout
          ? { kind: "workout", workout: data.workout }
          : { kind: "days", days: data.days, firstName: data.firstName, deloadAdvice: data.deload.advice },
      );
    } catch (error) {
      setState({ kind: "error", message: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Повертаючись на вкладку, оновлюємо список днів (дата останнього тренування могла змінитись).
  useEffect(() => {
    if (visible && state.kind === "days") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  let content;
  switch (state.kind) {
    case "loading":
      content = <LoadState error={null} onRetry={() => void load()} />;
      break;
    case "error":
      content = <LoadState error={state.message} onRetry={() => void load()} />;
      break;
    case "days":
      content = (
        <DaysScreen
          days={state.days}
          firstName={state.firstName}
          deloadAdvice={state.deloadAdvice}
          onStarted={(workout) => setState({ kind: "workout", workout })}
        />
      );
      break;
    case "workout":
      content = (
        <WorkoutScreen
          initial={state.workout}
          onFinished={(summary) => setState({ kind: "summary", summary })}
          onCancelled={() => void load()}
        />
      );
      break;
    case "summary":
      content = <SummaryScreen summary={state.summary} onDone={() => void load()} />;
      break;
  }

  return <div style={{ display: visible ? "block" : "none" }}>{content}</div>;
}

export function App() {
  const [tab, setTab] = useState<Tab>("workout");

  return (
    <>
      {/* Вкладка тренування живе весь час, щоб не губити таймер і поточну вправу. */}
      <WorkoutTab visible={tab === "workout"} />
      {tab === "day" ? <DayScreen /> : null}
      {tab === "program" ? <ProgramScreen /> : null}
      {tab === "history" ? <HistoryScreen /> : null}
      {tab === "progress" ? <ProgressScreen /> : null}
      <TabBar tab={tab} onChange={setTab} />
    </>
  );
}
