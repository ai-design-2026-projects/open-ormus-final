import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { track, permanentWrite, _resetForTesting } from "../progress";

// In test environments process.stdout.isTTY is falsy, so log-update's in-place
// rendering is skipped and output goes to plain stdout writes.

describe("track() — non-TTY mode", () => {
  let stdoutLines: string[];
  const origWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    _resetForTesting();
    stdoutLines = [];
    (process.stdout as NodeJS.WriteStream).write = (chunk: unknown) => {
      stdoutLines.push(String(chunk));
      return true;
    };
  });

  afterEach(() => {
    (process.stdout as NodeJS.WriteStream).write = origWrite;
  });

  it("tick(true) writes label and count to stdout", () => {
    const h = track("judge", 3);
    h.tick(true);
    expect(stdoutLines).toContain("[judge] 1/3\n");
  });

  it("tick(false) also increments the counter", () => {
    const h = track("drift", 5);
    h.tick(true);
    h.tick(false);
    h.tick(true);
    const counterLines = stdoutLines.filter((l) => l.startsWith("[drift]"));
    expect(counterLines).toEqual(["[drift] 1/5\n", "[drift] 2/5\n", "[drift] 3/5\n"]);
  });

  it("fail() writes the block to stdout", () => {
    const h = track("reconstruct", 2);
    h.fail("✗ [reconstruct] scenario_001 · Alex\n  scene: /path/file.yaml:1");
    expect(stdoutLines.join("")).toContain("✗ [reconstruct]");
  });

  it("print() writes the line to stdout", () => {
    const h = track("judge", 4);
    h.print("[1/4] conv.yaml — skipped (no messages)");
    expect(stdoutLines.join("")).toContain("skipped");
  });

  it("multiple registered passes each write their own label", () => {
    const j = track("judge", 2);
    const d = track("drift", 3);
    j.tick(true);
    d.tick(true);
    expect(stdoutLines).toContain("[judge] 1/2\n");
    expect(stdoutLines).toContain("[drift] 1/3\n");
  });
});

describe("permanentWrite() — non-TTY mode", () => {
  let stdoutLines: string[];
  const origWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    _resetForTesting();
    stdoutLines = [];
    (process.stdout as NodeJS.WriteStream).write = (chunk: unknown) => {
      stdoutLines.push(String(chunk));
      return true;
    };
  });

  afterEach(() => {
    (process.stdout as NodeJS.WriteStream).write = origWrite;
  });

  it("writes text with trailing newline", () => {
    permanentWrite("some line");
    expect(stdoutLines.join("")).toContain("some line\n");
  });

  it("does not double-newline if text already ends with \\n", () => {
    permanentWrite("already\n");
    const joined = stdoutLines.join("");
    expect(joined).toBe("already\n");
  });
});
