import { SessionSetRow } from "./analytics.service";

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildSetsCsv(rows: SessionSetRow[]): string {
  const header = ["date", "day", "exercise", "set", "weight_kg", "reps", "rpe", "note"];
  const lines = [header.join(",")];

  for (const row of rows) {
    lines.push(
      [
        csvCell(row.date),
        csvCell(row.dayName),
        csvCell(row.exerciseName),
        csvCell(row.setNumber),
        csvCell(row.weight),
        csvCell(row.reps),
        csvCell(row.rpe),
        csvCell(row.note),
      ].join(","),
    );
  }

  return "\ufeff" + lines.join("\n");
}
