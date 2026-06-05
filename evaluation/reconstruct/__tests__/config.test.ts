import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadReconstructConfig } from "../config";

const TMP = join(process.cwd(), "evaluation", "results", "__test_reconstruct_config__");
const CONVERSATIONS = join(TMP, "conversations");

beforeEach(() => {
  mkdirSync(CONVERSATIONS, { recursive: true });
  process.env["LLM_API_KEY"] = "test-key";
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env["LLM_API_KEY"];
});

const validYaml = `
dataset_dir: __test_reconstruct_config__
output_name: run-001
base_url: https://openrouter.ai/api
reconstructor:
  model: mistralai/mistral-nemo
comparators:
  - model: mistralai/mistral-nemo
  - model: google/gemma-2-9b-it
`;

describe("loadReconstructConfig", () => {
  it("loads a valid config", () => {
    const cfg = loadReconstructConfig(validYaml);
    expect(cfg.outputName).toBe("run-001");
    expect(cfg.reconstructorModel).toBe("mistralai/mistral-nemo");
    expect(cfg.comparators).toHaveLength(2);
    expect(cfg.comparators[0]!.label).toBe("comparator_1");
    expect(cfg.fields).toHaveLength(6);
  });

  it("accepts optional fields override", () => {
    const yaml = validYaml + "\nfields:\n  - values\n  - fears\n";
    const cfg = loadReconstructConfig(yaml);
    expect(cfg.fields).toEqual(["values", "fears"]);
  });

  it("throws when LLM_API_KEY is missing", () => {
    delete process.env["LLM_API_KEY"];
    expect(() => loadReconstructConfig(validYaml)).toThrow("LLM_API_KEY");
  });

  it("throws when output directory already exists", () => {
    mkdirSync(join(TMP, "reconstruct_persona", "run-001"), { recursive: true });
    expect(() => loadReconstructConfig(validYaml)).toThrow("already exists");
  });

  it("throws when conversations directory is missing", () => {
    rmSync(CONVERSATIONS, { recursive: true });
    expect(() => loadReconstructConfig(validYaml)).toThrow("conversations");
  });

  it("throws when dataset_dir contains a slash", () => {
    const yaml = validYaml.replace("__test_reconstruct_config__", "foo/bar");
    expect(() => loadReconstructConfig(yaml)).toThrow();
  });

  it("throws when no comparators are provided", () => {
    const yaml = validYaml.replace(/comparators:[\s\S]*?(?=\n\w|$)/, "comparators: []");
    expect(() => loadReconstructConfig(yaml)).toThrow();
  });
});
