import { ReactNode, useCallback, useEffect, useState } from "react";
import { haptic } from "./telegram";

interface StepperProps {
  value: number;
  step: number;
  unit: string;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

export function Stepper({ value, step, unit, min = 0, max = Infinity, onChange }: StepperProps) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  const change = (delta: number) => {
    haptic.tap();
    onChange(clamp(value + delta));
  };
  return (
    <div className="stepper">
      <button className="step-btn" aria-label="Менше" onClick={() => change(-step)}>
        −
      </button>
      <div className="step-value">
        <input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : 0}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const n = parseFloat(e.target.value.replace(",", "."));
            onChange(Number.isFinite(n) ? clamp(n) : min);
          }}
        />
        <div className="step-unit">{unit}</div>
      </div>
      <button className="step-btn" aria-label="Більше" onClick={() => change(step)}>
        +
      </button>
    </div>
  );
}

/** Завантаження даних екрана з повтором при помилці. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setData(await loader());
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, reload };
}

export function LoadState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return <div className="center muted">Завантаження…</div>;
  return (
    <div className="center">
      <div>{error}</div>
      <button className="link" onClick={onRetry}>
        Спробувати ще раз
      </button>
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div className="muted small">{title}</div>
        {aside}
      </div>
      {children}
    </div>
  );
}

export type Tab = "workout" | "day" | "program" | "history" | "progress";

const TAB_ICONS: Record<Tab, ReactNode> = {
  workout: <path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" />,
  day: <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z" />,
  program: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  history: <path d="M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  progress: <path d="M4 19h16M5 15l4-4 4 3 6-7" />,
};

const TAB_LABELS: Record<Tab, string> = {
  workout: "Тренування",
  day: "День",
  program: "Програма",
  history: "Історія",
  progress: "Прогрес",
};

export function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tabbar">
      {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
        <button
          key={t}
          className={`tab${t === tab ? " active" : ""}`}
          onClick={() => {
            if (t !== tab) haptic.tap();
            onChange(t);
          }}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {TAB_ICONS[t]}
          </svg>
          <span>{TAB_LABELS[t]}</span>
        </button>
      ))}
    </nav>
  );
}
