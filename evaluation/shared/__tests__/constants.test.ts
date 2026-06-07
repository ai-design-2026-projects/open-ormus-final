import { describe, test, expect } from "bun:test";
import { PASS_DIRS, DRIFT_THRESHOLD_DEGRADING, DRIFT_THRESHOLD_IMPROVING } from "../constants";

describe("PASS_DIRS", () => {
  test("has all three passes", () => {
    expect(PASS_DIRS.judge).toBe("judge_guessing");
    expect(PASS_DIRS.reconstruct).toBe("reconstruct_persona");
    expect(PASS_DIRS.drift).toBe("context_drift");
  });
});

describe("drift thresholds", () => {
  test("degrading < improving", () => {
    expect(DRIFT_THRESHOLD_DEGRADING).toBeLessThan(0);
    expect(DRIFT_THRESHOLD_IMPROVING).toBeGreaterThan(0);
  });
});
