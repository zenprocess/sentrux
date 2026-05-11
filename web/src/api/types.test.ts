import { describe, it, expect } from "vitest";
import { verdictFor, INDICATOR_ORDER } from "./types";

describe("verdictFor", () => {
  it("returns READY at or above 70", () => {
    expect(verdictFor(70)).toBe("READY");
    expect(verdictFor(100)).toBe("READY");
  });
  it("returns CONDITIONAL between 40 (inclusive) and 70 (exclusive)", () => {
    expect(verdictFor(69)).toBe("CONDITIONAL");
    expect(verdictFor(40)).toBe("CONDITIONAL");
  });
  it("returns BLOCK below 40", () => {
    expect(verdictFor(39)).toBe("BLOCK");
    expect(verdictFor(0)).toBe("BLOCK");
  });
});

describe("INDICATOR_ORDER", () => {
  it("contains the five canonical indicators in a stable order", () => {
    expect(INDICATOR_ORDER).toEqual([
      "acyclicity",
      "depth",
      "equality",
      "modularity",
      "redundancy",
    ]);
  });
});
