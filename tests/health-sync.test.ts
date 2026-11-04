import { describe, expect, it } from "vitest";
import { isStaleSleep, normalizeSleepMinutes, parseSyncBody } from "../src/server/health-sync";

describe("isStaleSleep", () => {
  it("flags the exact same sleep as the previous night", () => {
    expect(isStaleSleep(398, 398)).toBe(true);
  });

  it("keeps a different night and the first night", () => {
    expect(isStaleSleep(520, 398)).toBe(false);
    expect(isStaleSleep(398, null)).toBe(false);
    expect(isStaleSleep(undefined, 398)).toBe(false);
  });
});
import { sanitizeHealthMetrics } from "../src/services/health.service";

describe("normalizeSleepMinutes", () => {
  it("accepts hours, minutes or seconds", () => {
    expect(normalizeSleepMinutes(7.5)).toBe(450);
    expect(normalizeSleepMinutes(450)).toBe(450);
    expect(normalizeSleepMinutes(27000)).toBe(450);
  });
});

describe("parseSyncBody", () => {
  it("sums sample arrays and drops zero fields", () => {
    const parsed = parseSyncBody({
      token: "t",
      steps: [1000, 2000],
      sleepMinutes: 23880,
      restingHr: 49,
      activeCalories: 0,
    });
    expect(parsed?.metrics).toMatchObject({ steps: 3000, sleepMinutes: 398, restingHr: 49 });
    expect(parsed?.metrics.activeCalories).toBeUndefined();
  });

  it("rejects a payload with only zeros", () => {
    expect(parseSyncBody({ token: "t", steps: 0, sleepMinutes: 0 })).toBeNull();
  });

  it("requires a token", () => {
    expect(parseSyncBody({ steps: 5000 })).toBeNull();
  });
});

describe("sanitizeHealthMetrics", () => {
  it("recovers a dropped decimal separator in active calories", () => {
    expect(sanitizeHealthMetrics({ activeCalories: 4570 }).activeCalories).toBe(457);
  });

  it("drops impossible values", () => {
    expect(sanitizeHealthMetrics({ restingHr: 5, steps: 999999 })).toMatchObject({
      restingHr: undefined,
      steps: undefined,
    });
  });
});
