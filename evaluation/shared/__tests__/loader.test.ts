import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConversationEntries } from "../loader";

const MINIMAL_YAML = `scenario_id: test-scenario
scenario_title: Test
characters: []
messages: []
`;

let tmpDir: string | null = null;

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "loader-test-"));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe("loadConversationEntries", () => {
  it("loads YAML files and returns parsed entries", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "a.yaml"), MINIMAL_YAML);
    const entries = loadConversationEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result.scenario_id).toBe("test-scenario");
  });

  it("returns entries sorted by filename", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "c.yaml"), MINIMAL_YAML);
    writeFileSync(join(dir, "a.yaml"), MINIMAL_YAML);
    writeFileSync(join(dir, "b.yaml"), MINIMAL_YAML);
    const entries = loadConversationEntries(dir);
    expect(entries.map((e) => e.file)).toEqual(["a.yaml", "b.yaml", "c.yaml"]);
  });

  it("sets index i matching position in sorted order", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "x.yaml"), MINIMAL_YAML);
    writeFileSync(join(dir, "y.yaml"), MINIMAL_YAML);
    writeFileSync(join(dir, "z.yaml"), MINIMAL_YAML);
    const entries = loadConversationEntries(dir);
    expect(entries.map((e) => e.i)).toEqual([0, 1, 2]);
  });

  it("file field is the filename only, not a full path", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "conv.yaml"), MINIMAL_YAML);
    const entries = loadConversationEntries(dir);
    expect(entries[0]!.file).toBe("conv.yaml");
    expect(entries[0]!.file).not.toContain("/");
  });

  it("filters out non-yaml files", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "a.yaml"), MINIMAL_YAML);
    writeFileSync(join(dir, "notes.txt"), "ignore me");
    writeFileSync(join(dir, "data.json"), "{}");
    const entries = loadConversationEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.file).toBe("a.yaml");
  });

  it("throws when directory contains no yaml files", () => {
    const dir = makeTmpDir();
    expect(() => loadConversationEntries(dir)).toThrow(dir);
  });

  it("throws ENOENT for a non-existent directory (distinct from empty dir)", () => {
    const missing = "/tmp/loader-test-nonexistent-path-xyzabc123";
    expect(() => loadConversationEntries(missing)).toThrow(/ENOENT|no such file/i);
  });

  it("throws when a YAML file has invalid syntax", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "bad.yaml"), "key: : {{{malformed");
    expect(() => loadConversationEntries(dir)).toThrow();
  });

  it("uppercase .YAML extension is excluded (case-sensitive filter)", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "A.YAML"), MINIMAL_YAML);
    expect(() => loadConversationEntries(dir)).toThrow();
  });
});
