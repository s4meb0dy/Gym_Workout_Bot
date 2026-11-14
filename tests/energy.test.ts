import { describe, expect, it } from "vitest";
import { isPlausibleTdee, macroSplit, parseGoal, slopePerDay } from "../src/services/energy.service";

describe("macroSplit", () => {
  it("splits 2600 kcal for a 69.7 kg lean bulk", () => {
    const split = macroSplit(2600, 69.7, "lean_bulk");
    expect(split).toEqual({ calories: 2600, protein: 155, fat: 65, carbs: 350 });
    expect(Math.abs(split.protein * 4 + split.fat * 9 + split.carbs * 4 - 2600)).toBeLessThanOrEqual(25);
  });

  it("raises protein on a cut and keeps fat at least 20% of calories", () => {
    const split = macroSplit(3500, 60, "cut");
    expect(split.protein).toBe(145);
    expect(split.fat * 9).toBeGreaterThanOrEqual(3500 * 0.2 - 45);
  });
});

describe("slopePerDay", () => {
  it("recovers the weight trend through daily noise", () => {
    const points = Array.from({ length: 14 }, (_, t) => ({ t, w: 70 + 0.03 * t + (t % 2 ? 0.2 : -0.2) }));
    expect(slopePerDay(points)).toBeCloseTo(0.03, 1);
  });
});

describe("parseGoal", () => {
  it("defaults to a lean bulk", () => {
    expect(parseGoal(undefined)).toBe("lean_bulk");
    expect(parseGoal("cut")).toBe("cut");
  });
});

describe("isPlausibleTdee", () => {
  it("rejects a water-driven 1800 kcal estimate for an active 70 kg, 182 cm lifter", () => {
    expect(isPlausibleTdee(1810, 70.8, 182)).toBe(false);
  });

  it("accepts a normal maintenance range", () => {
    expect(isPlausibleTdee(2500, 70.8, 182)).toBe(true);
    expect(isPlausibleTdee(3000, 70.8, 182)).toBe(true);
  });

  it("rejects an absurdly high estimate", () => {
    expect(isPlausibleTdee(4500, 70.8, 182)).toBe(false);
  });
});
