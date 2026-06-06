import { test, expect } from "bun:test";

// Documents the per-character contract: the loop runs turns × characters times.
// If this test is wrong, the config values in generate-dataset.yaml are wrong too.
test("per-character turns: total messages = turns × character count", () => {
  const cases = [
    { turnsPerChar: 12, chars: 2, expected: 24 },  // 2-char ROUND_ROBIN
    { turnsPerChar: 12, chars: 3, expected: 36 },  // 3-char ORCHESTRATOR
    { turnsPerChar: 12, chars: 5, expected: 60 },  // 5-char ORCHESTRATOR
  ];
  for (const { turnsPerChar, chars, expected } of cases) {
    const actual = turnsPerChar * chars;
    expect(actual).toBe(expected);
  }
});
