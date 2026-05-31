import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { loadJudgeConfig } from "../config";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpBase: string;
let configPath: string;

// The function resolves dataset_dir relative to process.cwd()/evaluation/results/
// We create a temp dataset dir there so the conversationsDir check passes.
const resultsBase = join(process.cwd(), "evaluation", "results");
const testDatasetName = `judge-config-test-${Date.now()}`;
const testConversationsDir = join(resultsBase, testDatasetName, "conversations");

beforeAll(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "judge-config-test-"));
  configPath = join(tmpBase, "config.yaml");
  process.env["LLM_API_KEY"] = "test-key";
  // Create a real conversations directory so the existence check passes
  mkdirSync(testConversationsDir, { recursive: true });
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  rmSync(join(resultsBase, testDatasetName), { recursive: true, force: true });
  delete process.env["LLM_API_KEY"];
});

const freshOutputName = () => `judge-out-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("loadJudgeConfig", () => {
  it("parses a valid config with 1 judge and labels it judge_1", () => {
    writeFileSync(
      configPath,
      `
dataset_dir: "${testDatasetName}"
output_name: "${freshOutputName()}"
base_url: "http://localhost:4000"
judges:
  - model: "claude-haiku-4-5"
`,
    );
    const config = loadJudgeConfig(configPath);
    expect(config.judges).toHaveLength(1);
    expect(config.judges[0]!.label).toBe("judge_1");
    expect(config.judges[0]!.model).toBe("claude-haiku-4-5");
    expect(config.baseUrl).toBe("http://localhost:4000");
  });

  it("parses a valid config with 3 judges and labels them correctly", () => {
    writeFileSync(
      configPath,
      `
dataset_dir: "${testDatasetName}"
output_name: "${freshOutputName()}"
base_url: "http://localhost:4000"
judges:
  - model: "model-a"
  - model: "model-b"
  - model: "model-c"
`,
    );
    const config = loadJudgeConfig(configPath);
    expect(config.judges).toHaveLength(3);
    expect(config.judges[0]!.label).toBe("judge_1");
    expect(config.judges[1]!.label).toBe("judge_2");
    expect(config.judges[2]!.label).toBe("judge_3");
  });

  it("throws a Zod error when 4 judges are provided", () => {
    writeFileSync(
      configPath,
      `
dataset_dir: "${testDatasetName}"
output_name: "${freshOutputName()}"
base_url: "http://localhost:4000"
judges:
  - model: "a"
  - model: "b"
  - model: "c"
  - model: "d"
`,
    );
    expect(() => loadJudgeConfig(configPath)).toThrow();
  });

  it("throws when dataset_dir is missing", () => {
    writeFileSync(
      configPath,
      `
output_name: "${freshOutputName()}"
base_url: "http://localhost:4000"
judges:
  - model: "claude-haiku-4-5"
`,
    );
    expect(() => loadJudgeConfig(configPath)).toThrow();
  });

  it("throws with a useful message when conversations directory does not exist", () => {
    writeFileSync(
      configPath,
      `
dataset_dir: "nonexistent-dataset-${Date.now()}"
output_name: "${freshOutputName()}"
base_url: "http://localhost:4000"
judges:
  - model: "claude-haiku-4-5"
`,
    );
    expect(() => loadJudgeConfig(configPath)).toThrow("conversations");
  });
});
