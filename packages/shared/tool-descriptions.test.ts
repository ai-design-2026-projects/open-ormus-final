import { describe, expect, test } from "bun:test";
import { TOOL_DESCRIPTIONS } from "./tool-descriptions";

describe("TOOL_DESCRIPTIONS", () => {
  test("character_create requires English fields", () => {
    expect(TOOL_DESCRIPTIONS.character_create).toContain("English");
  });
  test("character_update requires English fields", () => {
    expect(TOOL_DESCRIPTIONS.character_update).toContain("English");
  });
});
