import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadDriftConfig } from "../config";

const TMP = join(import.meta.dir, "__tmp__");
const EVAL_NAME = "eval-01";
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
segments: 3
judges:
  - model: "model-a"
  - model: "model-b"
`;

describe("loadDriftConfig", () => {
  it("parses a valid config", () => {
    const cfg = loadDriftConfig(validYaml, EVAL_NAME, TMP);
    expect(cfg.segments).toBe(3);
    expect(cfg.judges).toHaveLength(2);
    expect(cfg.judges[0]!.label).toBe("judge_1");
    expect(cfg.judges[1]!.model).toBe("model-b");
    expect(cfg.baseUrl).toBe("http://localhost:4000");
    expect(cfg.evalDir).toBe(join(TMP, "dataset-001", EVAL_NAME));
  });

  it("throws when segments < 2", () => {
    const yaml = validYaml.replace("segments: 3", "segments: 1");
    expect(() => loadDriftConfig(yaml, EVAL_NAME, TMP)).toThrow("segments must be ≥ 2");
  });

  it("throws when judges array is empty", () => {
    const yaml = validYaml.replace(
      "judges:\n  - model: \"model-a\"\n  - model: \"model-b\"",
      "judges: []",
    );
    expect(() => loadDriftConfig(yaml, EVAL_NAME, TMP)).toThrow("at least 1 judge required");
  });

  it("throws when conversations dir does not exist", () => {
    const yaml = validYaml.replace("dataset-001", "nonexistent-dir");
    expect(() => loadDriftConfig(yaml, EVAL_NAME, TMP)).toThrow("Conversations directory not found");
  });

  it("throws when drift output directory already exists", () => {
    mkdirSync(join(TMP, "dataset-001", EVAL_NAME, "context_drift"), { recursive: true });
    expect(() => loadDriftConfig(validYaml, EVAL_NAME, TMP)).toThrow("already exists");
    rmSync(join(TMP, "dataset-001", EVAL_NAME, "context_drift"), { recursive: true });
  });

  it("throws when LLM_API_KEY is not set", () => {
    delete process.env["LLM_API_KEY"];
    expect(() => loadDriftConfig(validYaml, EVAL_NAME, TMP)).toThrow("LLM_API_KEY");
    process.env["LLM_API_KEY"] = "test-key";
  });

  it("throws when LLM_BASE_URL is not set", () => {
    delete process.env["LLM_BASE_URL"];
    expect(() => loadDriftConfig(validYaml, EVAL_NAME, TMP)).toThrow("LLM_BASE_URL");
    process.env["LLM_BASE_URL"] = "http://localhost:4000";
  });

  it("throws when EVAL_RESULTS_PATH is not set and resultsBasePath is not passed", () => {
    const saved = process.env.EVAL_RESULTS_PATH;
    delete process.env.EVAL_RESULTS_PATH;
    try {
      expect(() => loadDriftConfig(validYaml, EVAL_NAME)).toThrow("EVAL_RESULTS_PATH");
    } finally {
      if (saved !== undefined) process.env.EVAL_RESULTS_PATH = saved;
    }
  });

  it("uses EVAL_RESULTS_PATH when resultsBasePath is not passed", () => {
    const saved = process.env.EVAL_RESULTS_PATH;
    process.env.EVAL_RESULTS_PATH = TMP;
    try {
      const cfg = loadDriftConfig(validYaml, EVAL_NAME);
      expect(cfg.evalDir).toBe(join(TMP, "dataset-001", EVAL_NAME));
    } finally {
      if (saved !== undefined) process.env.EVAL_RESULTS_PATH = saved;
      else delete process.env.EVAL_RESULTS_PATH;
    }
  });
});
