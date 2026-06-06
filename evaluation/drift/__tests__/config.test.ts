import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadDriftConfig } from "../config";

const TMP = join(import.meta.dir, "__tmp__");
const CONVS = join(TMP, "dataset-001", "conversations");

beforeAll(() => {
  mkdirSync(CONVS, { recursive: true });
  process.env["LLM_API_KEY"] = "test-key";
  process.env["LLM_BASE_URL"] = "http://localhost:4000";
});

afterAll(() => {
  rmSync(TMP, { recursive: true });
  delete process.env["LLM_API_KEY"];
  delete process.env["LLM_BASE_URL"];
});

const validYaml = `
dataset_dir: "dataset-001"
output_name: "drift-run-001"
segments: 3
judges:
  - model: "model-a"
  - model: "model-b"
`;

describe("loadDriftConfig", () => {
  it("parses a valid config", () => {
    const cfg = loadDriftConfig(validYaml, TMP);
    expect(cfg.segments).toBe(3);
    expect(cfg.judges).toHaveLength(2);
    expect(cfg.judges[0]!.label).toBe("judge_1");
    expect(cfg.judges[1]!.model).toBe("model-b");
    expect(cfg.baseUrl).toBe("http://localhost:4000");
  });

  it("throws when segments < 2", () => {
    const yaml = validYaml.replace("segments: 3", "segments: 1");
    expect(() => loadDriftConfig(yaml, TMP)).toThrow("segments must be ≥ 2");
  });

  it("throws when judges array is empty", () => {
    const yaml = validYaml.replace(
      "judges:\n  - model: \"model-a\"\n  - model: \"model-b\"",
      "judges: []",
    );
    expect(() => loadDriftConfig(yaml, TMP)).toThrow("at least 1 judge required");
  });

  it("throws when conversations dir does not exist", () => {
    const yaml = validYaml.replace("dataset-001", "nonexistent-dir");
    expect(() => loadDriftConfig(yaml, TMP)).toThrow("conversations directory not found");
  });

  it("throws when output_name directory already exists", () => {
    mkdirSync(join(TMP, "dataset-001", "context_drift", "drift-run-001"), { recursive: true });
    expect(() => loadDriftConfig(validYaml, TMP)).toThrow("already exists");
    rmSync(join(TMP, "dataset-001", "context_drift", "drift-run-001"), { recursive: true });
  });

  it("throws when LLM_API_KEY is not set", () => {
    delete process.env["LLM_API_KEY"];
    expect(() => loadDriftConfig(validYaml, TMP)).toThrow("LLM_API_KEY");
    process.env["LLM_API_KEY"] = "test-key";
  });

  it("throws when LLM_BASE_URL is not set", () => {
    delete process.env["LLM_BASE_URL"];
    expect(() => loadDriftConfig(validYaml, TMP)).toThrow("LLM_BASE_URL");
    process.env["LLM_BASE_URL"] = "http://localhost:4000";
  });
});
