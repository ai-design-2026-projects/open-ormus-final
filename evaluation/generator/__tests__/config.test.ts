import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { loadConfig } from "../config";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpBase: string;
let configPath: string;

beforeAll(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "eval-config-test-"));
  configPath = join(tmpBase, "config.yaml");
  process.env["LLM_API_KEY"] = "test-key";
  process.env["LLM_BASE_URL"] = "http://localhost:4000";
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  delete process.env["LLM_API_KEY"];
  delete process.env["LLM_BASE_URL"];
});

// Unique output_dir that won't exist
const freshDir = () => `test-output-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("loadConfig", () => {
  it("parses a valid config and resolves characters and scenario", () => {
    const dir = freshDir();
    writeFileSync(
      configPath,
      `
output_dir: "${dir}"
default_model: "claude-haiku-4-5"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 3
    turn_strategy: ROUND_ROBIN
`,
    );
    const config = loadConfig(configPath, tmpBase);
    expect(config.runs).toHaveLength(1);
    expect(config.runs[0]!.scenario.id).toBe("scenario_001");
    expect(config.runs[0]!.characters).toHaveLength(2);
    expect(config.runs[0]!.characters[0]!.id).toBe("char_001");
    expect(config.runs[0]!.model).toBe("claude-haiku-4-5");
    expect(config.runs[0]!.turn_strategy).toBe("ROUND_ROBIN");
    expect(config.rawConfigText).toContain("scenario_001");
    expect(config.evalName).toBe("eval-01");
    expect(config.datasetDir).toBe(dir);
  });

  it("per-run model overrides default_model", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
default_model: "default-model"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 2
    model: "override-model"
    turn_strategy: ROUND_ROBIN
`,
    );
    const config = loadConfig(configPath, tmpBase);
    expect(config.runs[0]!.model).toBe("override-model");
  });

  it("auto-increments evalName when eval-01 already exists", () => {
    const dir = `test-ds-${Date.now()}`;
    mkdirSync(join(tmpBase, dir, "eval-01"), { recursive: true });
    writeFileSync(
      configPath,
      `
output_dir: "${dir}"
default_model: "m"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    const config = loadConfig(configPath, tmpBase);
    expect(config.evalName).toBe("eval-02");
    expect(config.datasetDir).toBe(dir);
  });

  it("throws if scenario not found in dataset", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
default_model: "m"
runs:
  - scenario: scenario_999_nonexistent
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("scenario_999_nonexistent");
  });

  it("throws if character not found in dataset", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
default_model: "m"
runs:
  - scenario: scenario_001
    characters: [char_001, char_NOTEXIST]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("char_NOTEXIST");
  });

  it("throws if no model and no default_model", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("no model");
  });

  it("throws if LLM_API_KEY not set", () => {
    delete process.env["LLM_API_KEY"];
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
default_model: "m"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("LLM_API_KEY");
    process.env["LLM_API_KEY"] = "test-key"; // restore
  });

  it("throws if LLM_BASE_URL not set", () => {
    delete process.env["LLM_BASE_URL"];
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
default_model: "m"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("LLM_BASE_URL");
    process.env["LLM_BASE_URL"] = "http://localhost:4000"; // restore
  });

  it("does not accept a concurrency field — parallelism is unconditional", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
default_model: "claude-haiku-4-5"
concurrency: 4
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 2
    turn_strategy: ROUND_ROBIN
`,
    );
    // Zod strips unknown fields — concurrency is silently ignored, not an error.
    // This test documents the intent: concurrency is not a config knob.
    expect(() => loadConfig(configPath, tmpBase)).not.toThrow();
    const config = loadConfig(configPath, tmpBase);
    expect(config.datasetDir).toBeDefined();
    expect(config.runs).toHaveLength(1);
  });

  it("throws if ORCHESTRATOR is used with 2 characters", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
default_model: "m"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ORCHESTRATOR
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("ORCHESTRATOR cannot be used with 2 characters");
  });
});
