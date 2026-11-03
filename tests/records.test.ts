import { describe, expect, it } from "vitest";
import { classifyRecord } from "../src/services/records.service";

describe("classifyRecord", () => {
  const history = [
    { weight: 20, reps: 10 },
    { weight: 22, reps: 8 },
  ];

  it("is not a record the first time an exercise is done", () => {
    expect(classifyRecord({ weight: 20, reps: 10 }, [])).toBeNull();
  });

  it("detects a heavier weight first", () => {
    expect(classifyRecord({ weight: 24, reps: 6 }, history)?.kind).toBe("weight");
  });

  it("detects a better estimated 1RM at a known weight", () => {
    expect(classifyRecord({ weight: 22, reps: 9 }, history)?.kind).toBe("e1rm");
  });

  it("detects more reps at a weight when 1RM is not beaten", () => {
    const withHeavy = [
      { weight: 30, reps: 5 },
      { weight: 20, reps: 8 },
    ];
    expect(classifyRecord({ weight: 20, reps: 10 }, withHeavy)?.kind).toBe("reps");
  });

  it("ignores an equal or worse set", () => {
    expect(classifyRecord({ weight: 20, reps: 10 }, history)).toBeNull();
    expect(classifyRecord({ weight: 18, reps: 8 }, history)).toBeNull();
  });
});
