import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadReconstructConfig } from "../config";

const RESULTS_BASE = join(process.cwd(), "evaluation", "results");
const TMP = join(RESULTS_BASE, "__test_reconstruct_config__");
const EVAL_NAME = "eval-test";
const EVAL_DIR = join(TMP, EVAL_NAME);
const CONVERSATIONS = join(TMP, "conversations");

beforeEach(() => {
  mkdirSync(CONVERSATIONS, { recursive: true });
  process.env["LLM_API_KEY"] = "test-key";
  process.env["LLM_BASE_URL"] = "http://localhost:4000";
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env["LLM_API_KEY"];
  delete process.env["LLM_BASE_URL"];
});

const validYaml = `
dataset_dir: __test_reconstruct_config__
reconstructor:
  model: mistralai/mistral-nemo
comparators:
  - model: mistralai/mistral-nemo
  - model: google/gemma-2-9b-it
`;

describe("loadReconstructConfig", () => {
  it("loads a valid config", () => {
    const cfg = loadReconstructConfig(validYaml, EVAL_NAME, RESULTS_BASE);
    expect(cfg.evalDir).toBe(EVAL_DIR);
    expect(cfg.reconstructorModel).toBe("mistralai/mistral-nemo");
    expect(cfg.comparators).toHaveLength(2);
    expect(cfg.comparators[0]!.label).toBe("comparator_1");
    expect(cfg.fields).toHaveLength(6);
  });

  it("accepts optional fields override", () => {
    const yaml = validYaml + "\nfields:\n  - values\n  - fears\n";
    const cfg = loadReconstructConfig(yaml, EVAL_NAME, RESULTS_BASE);
    expect(cfg.fields).toEqual(["values", "fears"]);
  });

  it("throws when LLM_API_KEY is missing", () => {
    delete process.env["LLM_API_KEY"];
    expect(() => loadReconstructConfig(validYaml, EVAL_NAME, RESULTS_BASE)).toThrow("LLM_API_KEY");
    process.env["LLM_API_KEY"] = "test-key"; // restore
  });

  it("throws when LLM_BASE_URL is missing", () => {
    delete process.env["LLM_BASE_URL"];
    expect(() => loadReconstructConfig(validYaml, EVAL_NAME, RESULTS_BASE)).toThrow("LLM_BASE_URL");
    process.env["LLM_BASE_URL"] = "http://localhost:4000"; // restore
  });

  it("throws when output directory already exists", () => {
    mkdirSync(join(EVAL_DIR, "reconstruct_persona"), { recursive: true });
    expect(() => loadReconstructConfig(validYaml, EVAL_NAME, RESULTS_BASE)).toThrow("already exists");
  });

  it("throws when conversations directory is missing", () => {
    rmSync(CONVERSATIONS, { recursive: true });
    expect(() => loadReconstructConfig(validYaml, EVAL_NAME, RESULTS_BASE)).toThrow("conversations");
  });

  it("throws when dataset_dir contains a slash", () => {
    const yaml = validYaml.replace("__test_reconstruct_config__", "foo/bar");
    expect(() => loadReconstructConfig(yaml, EVAL_NAME, RESULTS_BASE)).toThrow();
  });

  it("throws when no comparators are provided", () => {
    const yaml = validYaml.replace(/comparators:[\s\S]*?(?=\n\w|$)/, "comparators: []");
    expect(() => loadReconstructConfig(yaml, EVAL_NAME, RESULTS_BASE)).toThrow();
  });

  it("defaults segments to 1 when omitted", () => {
    const cfg = loadReconstructConfig(validYaml, EVAL_NAME, RESULTS_BASE);
    expect(cfg.segments).toBe(1);
  });

  it("accepts explicit segments value", () => {
    const yaml = validYaml + "\nsegments: 3\n";
    const cfg = loadReconstructConfig(yaml, EVAL_NAME, RESULTS_BASE);
    expect(cfg.segments).toBe(3);
  });

  it("throws when segments is 0", () => {
    const yaml = validYaml + "\nsegments: 0\n";
    expect(() => loadReconstructConfig(yaml, EVAL_NAME, RESULTS_BASE)).toThrow();
  });

  it("throws when EVAL_RESULTS_PATH is not set and resultsBasePath is not passed", () => {
    const saved = process.env.EVAL_RESULTS_PATH;
    delete process.env.EVAL_RESULTS_PATH;
    try {
      expect(() => loadReconstructConfig(validYaml, EVAL_NAME)).toThrow("EVAL_RESULTS_PATH");
    } finally {
      if (saved !== undefined) process.env.EVAL_RESULTS_PATH = saved;
    }
  });

  it("uses EVAL_RESULTS_PATH when resultsBasePath is not passed", () => {
    const saved = process.env.EVAL_RESULTS_PATH;
    process.env.EVAL_RESULTS_PATH = RESULTS_BASE;
    try {
      const cfg = loadReconstructConfig(validYaml, EVAL_NAME);
      expect(cfg.evalDir).toBe(EVAL_DIR);
    } finally {
      if (saved !== undefined) process.env.EVAL_RESULTS_PATH = saved;
      else delete process.env.EVAL_RESULTS_PATH;
    }
  });
});
