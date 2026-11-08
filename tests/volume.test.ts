import { describe, expect, it } from "vitest";
import { summarizeVolume } from "../src/services/analytics.service";

const ex = (muscleGroup: string, progressionMode = "weight") => ({ muscleGroup, progressionMode });

describe("summarizeVolume", () => {
  it("counts bodyweight abs work logged with weight 0", () => {
    const volume = summarizeVolume(
      [
        { weight: 32, reps: 15, exercise: ex("Прес/Кор") },
        { weight: 0, reps: 15, exercise: ex("Прес/Кор") },
        { weight: 0, reps: 15, exercise: ex("Прес/Кор") },
      ],
      70,
    );
    expect(volume).toEqual([{ muscleGroup: "Прес/Кор", sets: 3, tonnage: 480 }]);
  });

  it("skips warm-up and posture checklists", () => {
    const volume = summarizeVolume(
      [
        { weight: 0, reps: 1, exercise: ex("Розминка") },
        { weight: 0, reps: 1, exercise: ex("Постава") },
      ],
      70,
    );
    expect(volume).toEqual([]);
  });

  it("uses bodyweight minus counterweight for Gravitron tonnage", () => {
    const volume = summarizeVolume(
      [
        { weight: 1, reps: 7, exercise: ex("Спина", "assist") },
        { weight: 9, reps: 10, exercise: ex("Спина", "assist") },
      ],
      70,
    );
    expect(volume).toEqual([{ muscleGroup: "Спина", sets: 2, tonnage: 70 * 7 + 61 * 10 }]);
  });
});
