export interface ChartDataset {
  label: string;
  data: (number | null)[];
  color: string;
  dashed?: boolean;
}

/**
 * Будує URL для рендера лінійного графіка через QuickChart.io.
 * Не потребує нативних залежностей — працює на будь-якому хостингу.
 */
export function buildLineChartUrl(
  title: string,
  labels: string[],
  datasets: ChartDataset[],
): string {
  const config = {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((d) => ({
        label: d.label,
        data: d.data,
        borderColor: d.color,
        backgroundColor: d.color,
        borderDash: d.dashed ? [6, 4] : [],
        fill: false,
        pointRadius: 2,
        tension: 0.25,
        spanGaps: true,
      })),
    },
    options: {
      title: { display: true, text: title },
      legend: { display: datasets.length > 1 },
      scales: {
        xAxes: [{ ticks: { maxTicksLimit: 10 } }],
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?w=640&h=400&bkg=white&c=${encoded}`;
}

/** Оцінка 1ПМ за формулою Еплі. */
export function estimateOneRepMax(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}
