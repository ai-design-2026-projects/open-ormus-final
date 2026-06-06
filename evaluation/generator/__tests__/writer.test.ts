import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { initOutputDir, writeConversation } from "../writer";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";

let tmpBase: string;

beforeAll(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "eval-writer-test-"));
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

const mockResult = {
  run_index: 1,
  scenario_id: "scenario_001",
  scenario_title: "Test",
  scenario_context: "Context.",
  initial_prompt: "Prompt.",
  characters: [{ id: "char_001", name: "Alice", archetype: "Rebel" }],
  model: "claude-haiku-4-5",
  turn_strategy: "ROUND_ROBIN",
  turns_requested: 2,
  started_at: "2026-05-28T10:00:00.000Z",
  completed_at: "2026-05-28T10:01:00.000Z",
  messages: [
    {
      turn: 1,
      character_id: "char_001",
      character_name: "Alice",
      emotion: "Joy",
      intensity: "low",
      subtext: "Hopeful.",
      reasoning: "Starting fresh.",
      content: "Hello there.",
    },
  ],
};

describe("initOutputDir", () => {
  it("creates run dir, conversations subdir, and copies config", () => {
    const runDir = initOutputDir(tmpBase, "my-run", "output_dir: my-run\n");
    expect(existsSync(runDir)).toBe(true);
    expect(existsSync(join(runDir, "conversations"))).toBe(true);
    expect(existsSync(join(runDir, "config.yaml"))).toBe(true);
    const configContent = readFileSync(join(runDir, "config.yaml"), "utf-8");
    expect(configContent).toBe("output_dir: my-run\n");
  });
});

describe("writeConversation", () => {
  it("writes a zero-padded YAML file parseable back to the original structure", () => {
    const runDir = initOutputDir(tmpBase, "write-test", "config: true\n");
    const convsDir = join(runDir, "conversations");
    writeConversation(convsDir, 1, mockResult);
    const filePath = join(convsDir, "001.yaml");
    expect(existsSync(filePath)).toBe(true);
    const parsed = parse(readFileSync(filePath, "utf-8")) as typeof mockResult;
    expect(parsed.run_index).toBe(1);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]!.content).toBe("Hello there.");
  });

  it("pads index to 3 digits", () => {
    const runDir = initOutputDir(tmpBase, "pad-test", "config: true\n");
    const convsDir = join(runDir, "conversations");
    writeConversation(convsDir, 7, mockResult);
    expect(existsSync(join(convsDir, "007.yaml"))).toBe(true);
  });
});
