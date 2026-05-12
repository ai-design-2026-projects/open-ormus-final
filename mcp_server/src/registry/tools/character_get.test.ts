import { describe, test, expect } from "bun:test";
import { characterGetHandler } from "./character_get";

describe("characterGetHandler", () => {
  test("returns fixture Aria by id", async () => {
    const result = await characterGetHandler({
      id: "00000000-0000-0000-0000-000000000001",
    });
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.name).toBe("Aria");
    }
  });

  test("returns not_found for unknown id", async () => {
    const result = await characterGetHandler({ id: "nonexistent-id" });
    expect(result).toEqual({ error: "not_found" });
  });
});
