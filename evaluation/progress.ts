import logUpdate from "log-update";

const isTTY = process.stdout.isTTY ?? false;

interface PassState {
  label: string;
  total: number;
  done: number;
  ok: number;
  fail: number;
}

// Ordered list of registered passes (registration order = display order).
const passes: PassState[] = [];

function render(): void {
  if (!isTTY) return;
  const lines = passes.map((p) => {
    const label = p.label.padEnd(12);
    const counter = `${p.done}/${p.total}`;
    const tally = p.fail > 0 ? `   ✓${p.ok} ✗${p.fail}` : "";
    return `  ${label} ${counter}${tally}`;
  });
  logUpdate(lines.join("\n"));
}

/**
 * Write a line that persists above the live block.
 * Use for failures, skipped notices, costs, and Done lines.
 */
export function permanentWrite(text: string): void {
  const line = text.trimEnd();
  if (isTTY) {
    logUpdate.clear();
    process.stdout.write(line + "\n");
    render();
  } else {
    process.stdout.write(line + "\n");
  }
}

export interface PassHandle {
  /** Increment the done counter. ok=true for success, false for failure. */
  tick(ok: boolean): void;
  /** Print a failure block above the live display (does NOT tick). */
  fail(block: string): void;
  /** Print a one-liner above the live display (for skipped items etc.). */
  print(line: string): void;
}

/**
 * Register a pass with the live renderer.
 * Call once per pass before the main loop. Returns a handle for per-item updates.
 */
export function track(label: string, total: number): PassHandle {
  const state: PassState = { label, total, done: 0, ok: 0, fail: 0 };
  passes.push(state);
  render(); // show the pass at 0/N immediately

  return {
    tick(ok: boolean): void {
      state.done++;
      if (ok) state.ok++;
      else state.fail++;
      if (isTTY) {
        render();
      } else {
        process.stdout.write(`[${state.label}] ${state.done}/${state.total}\n`);
      }
    },
    fail(block: string): void {
      permanentWrite(block);
    },
    print(line: string): void {
      permanentWrite(line);
    },
  };
}

/** Call after all passes complete to freeze the live display. */
export function finalize(): void {
  if (isTTY) logUpdate.done();
}

/** Reset module state between tests. Do not use in production code. */
export function _resetForTesting(): void {
  passes.length = 0;
}
