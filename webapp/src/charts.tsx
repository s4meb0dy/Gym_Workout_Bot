import { fmtNumber, fmtWeight } from "./format";

interface LinePoint {
  label: string;
  value: number;
}

/** Лінійний графік на SVG: область під лінією, точки, підписи першого/останнього значення. */
export function LineChart({ points, unit }: { points: LinePoint[]; unit: string }) {
  if (points.length === 0) return null;

  const W = 340;
  const H = 170;
  const pad = { top: 18, right: 14, bottom: 24, left: 34 };
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.1;
  max += span * 0.1;

  const x = (i: number) =>
    pad.left + (points.length === 1 ? (W - pad.left - pad.right) / 2 : (i / (points.length - 1)) * (W - pad.left - pad.right));
  const y = (v: number) => pad.top + (1 - (v - min) / (max - min)) * (H - pad.top - pad.bottom);

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${x(0)},${H - pad.bottom} ${line} ${x(points.length - 1)},${H - pad.bottom}`;
  const bestIndex = values.indexOf(Math.max(...values));
  const ticks = [min + (max - min) * 0.15, (min + max) / 2, max - (max - min) * 0.15];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Графік прогресу">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="0.5" />
          <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
            {Math.round(t)}
          </text>
        </g>
      ))}
      <polygon points={area} fill="var(--accent)" opacity="0.12" />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={i === bestIndex ? 4 : 2.5} fill={i === bestIndex ? "var(--success)" : "var(--accent)"} />
      ))}
      <text x={x(bestIndex)} y={y(values[bestIndex]) - 8} textAnchor="middle" fontSize="11" fill="var(--success)">
        {fmtWeight(values[bestIndex])} {unit}
      </text>
      <text x={pad.left} y={H - 6} fontSize="10" fill="var(--muted)">
        {points[0].label}
      </text>
      {points.length > 1 ? (
        <text x={W - pad.right} y={H - 6} textAnchor="end" fontSize="10" fill="var(--muted)">
          {points[points.length - 1].label}
        </text>
      ) : null}
    </svg>
  );
}

/** Вертикальні стовпчики (наприклад, тоннаж по тижнях); останній — поточний період. */
export function ColumnChart({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="columns">
      {items.map((item, i) => (
        <div key={item.label} className="column">
          <div className="column-value tiny">{item.value > 0 ? fmtCompact(item.value) : ""}</div>
          <div className="column-track">
            <div
              className="column-bar"
              style={{
                height: `${(item.value / max) * 100}%`,
                background: i === items.length - 1 ? "var(--accent)" : "#2f4a6b",
              }}
            />
          </div>
          <div className="muted tiny">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function fmtCompact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}т` : fmtNumber(n);
}

/** Горизонтальні смуги (наприклад, підходи по м'язових групах). */
export function BarList({ items, unit }: { items: Array<{ label: string; value: number }>; unit: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="list" style={{ padding: "6px 14px" }}>
      {items.map((item) => (
        <div key={item.label} style={{ padding: "7px 0" }}>
          <div className="row spread small">
            <span>{item.label}</span>
            <span className="muted">
              {item.value} {unit}
            </span>
          </div>
          <div className="progress" style={{ marginTop: 5 }}>
            <div style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
