import { describe, expect, it } from "vitest";
import { calculateProgression, parseSetInput } from "../src/services/progression";

describe("calculateProgression", () => {
  it("adds the step when every working set hit the top of the rep range", () => {
    const sets = [
      { weight: 20, reps: 10 },
      { weight: 20, reps: 10 },
      { weight: 20, reps: 10 },
    ];
    const result = calculateProgression(sets, 3, 8, 10, { progressionStep: 2 });
    expect(result.shouldIncreaseWeight).toBe(true);
    expect(result.suggestedWeight).toBe(22);
  });

  it("keeps the weight when the rep target was missed", () => {
    const sets = [
      { weight: 20, reps: 10 },
      { weight: 20, reps: 9 },
      { weight: 20, reps: 8 },
    ];
    const result = calculateProgression(sets, 3, 8, 10, { progressionStep: 2 });
    expect(result.shouldIncreaseWeight).toBe(false);
    expect(result.suggestedWeight).toBe(20);
  });

  it("uses the heaviest set as working weight when the last set is a back-off", () => {
    const sets = [
      { weight: 30, reps: 8 },
      { weight: 30, reps: 8 },
      { weight: 25, reps: 10 },
    ];
    const result = calculateProgression(sets, 3, 8, 10, { progressionStep: 2.5 });
    expect(result.lastWeight).toBe(30);
    expect(result.suggestedWeight).toBe(30);
  });

  it("lowers the counterweight for assisted exercises", () => {
    const sets = [
      { weight: 30, reps: 10 },
      { weight: 30, reps: 10 },
      { weight: 30, reps: 10 },
    ];
    const result = calculateProgression(sets, 3, 8, 10, { progressionMode: "assist", progressionStep: 5 });
    expect(result.suggestedWeight).toBe(25);
  });

  it("stops at bodyweight instead of suggesting zero counterweight", () => {
    const fromAssist = calculateProgression(
      [
        { weight: 2, reps: 10 },
        { weight: 2, reps: 10 },
        { weight: 2, reps: 10 },
      ],
      3,
      6,
      10,
      { progressionMode: "assist", progressionStep: 2 },
    );
    expect(fromAssist.suggestedWeight).toBe(1);
    expect(fromAssist.message).toContain("власна вага");

    const atBodyweight = calculateProgression([{ weight: 1, reps: 8 }], 1, 6, 10, {
      progressionMode: "assist",
      progressionStep: 2,
    });
    expect(atBodyweight.suggestedWeight).toBe(1);
    expect(atBodyweight.message).toContain("більше повторень");
  });

  it("suggests the baseline on the first workout", () => {
    const result = calculateProgression([], 3, 8, 10, {
      baselineWeightMin: 10,
      baselineWeightMax: 14,
      baselineNote: "10–14 кг",
    });
    expect(result.suggestedWeight).toBe(12);
  });
});

describe("parseSetInput", () => {
  it.each([
    ["100x8", { weight: 100, reps: 8 }],
    ["100 х 8", { weight: 100, reps: 8 }],
    ["22,5*10", { weight: 22.5, reps: 10 }],
  ])("parses %s", (input, expected) => {
    expect(parseSetInput(input)).toMatchObject(expected);
  });

  it("reads RPE", () => {
    expect(parseSetInput("100 8 @9")).toMatchObject({ weight: 100, reps: 8, rpe: 9 });
  });

  it("uses the current weight when only reps are given", () => {
    expect(parseSetInput("8", "reps", 60)).toMatchObject({ weight: 60, reps: 8 });
    expect(parseSetInput("8")).toBeNull();
  });

  it("rejects nonsense", () => {
    expect(parseSetInput("abc")).toBeNull();
    expect(parseSetInput("0x8")).toBeNull();
    expect(parseSetInput("100x500")).toBeNull();
  });
});
