import { describe, expect, it } from "vitest";
import { countWeeksInARow } from "../src/services/deload.service";

describe("countWeeksInARow", () => {
  it("counts full weeks since the last light week", () => {
    expect(countWeeksInARow([4, 4, 2, 4, 3, 4, 4])).toBe(4);
  });

  it("treats a missed week as a break", () => {
    expect(countWeeksInARow([4, 4, 4, 0, 4])).toBe(1);
  });

  it("never counts empty weeks without a regular routine", () => {
    expect(countWeeksInARow([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0])).toBe(0);
  });

  it("counts every week when there was no break", () => {
    expect(countWeeksInARow([4, 4, 3, 4, 4, 4, 3, 4])).toBe(8);
  });
});
