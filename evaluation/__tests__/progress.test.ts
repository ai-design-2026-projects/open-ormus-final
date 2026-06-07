import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ProgressReporter } from "../progress";

describe("ProgressReporter", () => {
  let stderrLines: string[];
  let stdoutLines: string[];
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origStdoutWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    stderrLines = [];
    stdoutLines = [];
    (process.stderr as any).write = (chunk: string) => { stderrLines.push(chunk); return true; };
    (process.stdout as any).write = (chunk: string) => { stdoutLines.push(chunk); return true; };
  });

  afterEach(() => {
    (process.stderr as any).write = origStderrWrite;
    (process.stdout as any).write = origStdoutWrite;
  });

  it("tick() writes label and count to stderr", () => {
    const r = new ProgressReporter("judge", 3);
    r.tick();
    expect(stderrLines).toEqual(["  [judge] 1/3\n"]);
  });

  it("tick() increments count on each call", () => {
    const r = new ProgressReporter("drift", 5);
    r.tick();
    r.tick();
    r.tick();
    expect(stderrLines).toEqual([
      "  [drift] 1/5\n",
      "  [drift] 2/5\n",
      "  [drift] 3/5\n",
    ]);
  });

  it("flush() writes buffered lines to stdout in registration order", () => {
    const r = new ProgressReporter("reconstruct", 2);
    const buf1 = r.itemBuffer();
    const buf2 = r.itemBuffer();
    buf1.push("a\n");
    buf2.push("b\n");
    buf1.push("c\n");
    r.flush();
    // buf1 items first (a, c), then buf2 items (b)
    expect(stdoutLines).toEqual(["a\n", "c\n", "b\n"]);
  });

  it("flush() on empty reporter writes nothing", () => {
    const r = new ProgressReporter("judge", 2);
    r.flush();
    expect(stdoutLines).toEqual([]);
  });

  it("flush() on registered but empty buffers writes nothing", () => {
    const r = new ProgressReporter("judge", 2);
    r.itemBuffer();
    r.itemBuffer();
    r.flush();
    expect(stdoutLines).toEqual([]);
  });

  it("itemBuffer() returns independent arrays", () => {
    const r = new ProgressReporter("judge", 2);
    const buf1 = r.itemBuffer();
    const buf2 = r.itemBuffer();
    buf1.push("only in buf1\n");
    expect(buf2).toEqual([]);
    expect(buf1).toEqual(["only in buf1\n"]);
  });
});
