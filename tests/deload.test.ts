import { describe, expect, it } from "vitest";
import { countWeeksInARow } from "../src/services/deload.service";

describe("countWeeksInARow", () => {
  it("counts full weeks since the last light week", () => {
    expect(countWeeksInARow([4, 4, 2, 4, 3, 4, 4])).toBe(4);
  });

  it("treats a missed week as a break", () => {
    expect(countWeeksInARow([4, 4, 4, 0, 4])).toBe(1);
  });

  it("counts every week when there was no break", () => {
    expect(countWeeksInARow([4, 4, 3, 4, 4, 4, 3, 4])).toBe(8);
  });
});
