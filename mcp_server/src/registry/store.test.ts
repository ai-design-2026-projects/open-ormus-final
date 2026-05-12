import { describe, test, expect } from "bun:test";
import { characterStore } from "./store";

describe("characterStore", () => {
  test("is pre-seeded with 2 fixture characters", () => {
    expect(characterStore.size).toBeGreaterThanOrEqual(2);
  });

  test("fixture Aria exists", () => {
    const aria = characterStore.get("00000000-0000-0000-0000-000000000001");
    expect(aria).toBeDefined();
    expect(aria?.name).toBe("Aria");
  });

  test("fixture Brann exists", () => {
    const brann = characterStore.get("00000000-0000-0000-0000-000000000002");
    expect(brann).toBeDefined();
    expect(brann?.traits).toContain("stoic");
  });
});
