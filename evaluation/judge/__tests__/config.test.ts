import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { loadJudgeConfig } from "../config";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpBase: string;
let configPath: string;
const testDataset = `judge-test-${Date.now()}`;
const testEval = "eval-01";

beforeAll(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "judge-cfg-"));
  configPath = join(tmpBase, "config.yaml");
  process.env["LLM_API_KEY"] = "test-key";
  process.env["LLM_BASE_URL"] = "http://localhost:4000";
  mkdirSync(join(tmpBase, testDataset, testEval, "conversations"), { recursive: true });
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  delete process.env["LLM_API_KEY"];
  delete process.env["LLM_BASE_URL"];
});

describe("loadJudgeConfig", () => {
  it("parses valid config with 1 judge", () => {
    writeFileSync(configPath, `dataset_dir: "${testDataset}"\njudges:\n  - model: "m"\n`);
    const config = loadJudgeConfig(configPath, testEval, tmpBase);
    expect(config.judges).toHaveLength(1);
    expect(config.judges[0]!.label).toBe("judge_1");
    expect(config.evalDir).toBe(join(tmpBase, testDataset, testEval));
  });

  it("throws when conversations dir missing", () => {
    writeFileSync(configPath, `dataset_dir: "no-such-dataset"\njudges:\n  - model: "m"\n`);
    expect(() => loadJudgeConfig(configPath, "eval-01", tmpBase)).toThrow("conversations");
  });

  it("throws when judge output already exists", () => {
    const ds = `ds-exist-${Date.now()}`;
    mkdirSync(join(tmpBase, ds, testEval, "conversations"), { recursive: true });
    mkdirSync(join(tmpBase, ds, testEval, "judge_guessing"), { recursive: true });
    writeFileSync(configPath, `dataset_dir: "${ds}"\njudges:\n  - model: "m"\n`);
    expect(() => loadJudgeConfig(configPath, testEval, tmpBase)).toThrow("already exists");
  });

  it("throws when LLM_BASE_URL not set", () => {
    delete process.env["LLM_BASE_URL"];
    writeFileSync(configPath, `dataset_dir: "${testDataset}"\njudges:\n  - model: "m"\n`);
    expect(() => loadJudgeConfig(configPath, testEval, tmpBase)).toThrow("LLM_BASE_URL");
    process.env["LLM_BASE_URL"] = "http://localhost:4000";
  });
});
