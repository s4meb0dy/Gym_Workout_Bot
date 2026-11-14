import { describe, expect, it } from "vitest";
import { isMeasurementDue, measurementInsight, parseMeasurement } from "../src/services/measurements.service";

const day = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 86400000);

describe("measurementInsight", () => {
  it("asks to repeat after the first measurement", () => {
    expect(measurementInsight([{ date: day(0), value: 78 }], [])).toContain("Перший замір");
  });

  it("calls it a clean bulk when weight rises and the waist barely moves", () => {
    const text = measurementInsight(
      [
        { date: day(0), value: 78 },
        { date: day(28), value: 78.3 },
      ],
      [
        { date: day(0), value: 70 },
        { date: day(28), value: 71 },
      ],
    );
    expect(text).toContain("Чистий набір");
  });

  it("warns when the waist grows faster than the weight", () => {
    const text = measurementInsight(
      [
        { date: day(0), value: 78 },
        { date: day(28), value: 80 },
      ],
      [
        { date: day(0), value: 70 },
        { date: day(28), value: 71 },
      ],
    );
    expect(text).toContain("більше жиру");
  });
});

describe("parseMeasurement", () => {
  it("keeps filled fields and accepts a comma", () => {
    expect(parseMeasurement({ waistCm: "78,5", armCm: 34, chestCm: "" })).toEqual({ waistCm: 78.5, armCm: 34 });
  });

  it("rejects impossible values and empty input", () => {
    expect(parseMeasurement({ waistCm: 7 })).toBeNull();
    expect(parseMeasurement({})).toBeNull();
  });
});

describe("isMeasurementDue", () => {
  it("is due on Sunday unless measured in the last few days", () => {
    expect(isMeasurementDue(7, "Sun")).toBe(true);
    expect(isMeasurementDue(1, "Sun")).toBe(false);
  });

  it("waits for Sunday mid-week but catches a missed Sunday", () => {
    expect(isMeasurementDue(5, "Wed")).toBe(false);
    expect(isMeasurementDue(8, "Tue")).toBe(true);
    expect(isMeasurementDue(null, "Tue")).toBe(true);
  });
});
