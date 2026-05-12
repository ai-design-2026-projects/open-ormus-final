import { describe, test, expect, beforeEach } from "bun:test";
import { characterCreateHandler } from "./character_create";
import { characterStore } from "../store";

describe("characterCreateHandler", () => {
  beforeEach(() => {
    // Remove any non-fixture entries from previous test runs
    for (const [id] of characterStore) {
      if (!id.startsWith("00000000")) characterStore.delete(id);
    }
  });

  test("returns a record with generated id", async () => {
    const result = await characterCreateHandler({
      name: "Lyra",
      description: "A traveling bard",
      traits: ["charismatic", "musical"],
    });
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(result.name).toBe("Lyra");
    expect(result.traits).toEqual(["charismatic", "musical"]);
    expect(result.createdAt).toBeTruthy();
  });

  test("stores the new character in characterStore", async () => {
    const result = await characterCreateHandler({
      name: "Zephyr",
      description: "A wind mage",
      traits: ["quick"],
    });
    expect(characterStore.get(result.id)).toEqual(result);
  });
});
