import { describe, expect, it } from "vitest";
import { countWeeksInARow } from "../src/services/deload.service";

describe("countWeeksInARow", () => {
  it("counts full weeks since the last light week", () => {
    expect(countWeeksInARow([70, 72, 20, 68, 70, 75, 71])).toBe(4);
  });

  it("treats a missed week as a break", () => {
    expect(countWeeksInARow([70, 70, 70, 0, 70])).toBe(1);
  });

  it("counts every week when there was no break", () => {
    expect(countWeeksInARow([60, 62, 65, 64, 66, 63, 61, 65])).toBe(8);
  });
});
