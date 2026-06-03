import { describe, expect, test } from "bun:test";
import { AGENT_SYSTEM_PROMPT } from "../prompt";

describe("AGENT_SYSTEM_PROMPT", () => {
  test("requires character data to be stored in English", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("stored in English");
  });
});
