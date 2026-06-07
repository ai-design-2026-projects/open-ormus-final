# Evaluation Pipeline Parallelization — Design Spec

**Date:** 2026-06-07
**Status:** Approved for implementation

---

## Problem

The evaluation pipeline is slow. The root cause is sequential execution at multiple levels:

1. **`run_pipeline.ts`** — three fully independent passes (judge, reconstruct, drift) run one after another
2. **`judge/index.ts`** — 3 judge models run sequentially per conversation
3. **`reconstruct/index.ts`** — characters within a conversation run sequentially; segments within each character also run sequentially
4. **`drift/index.ts`** — segments within a conversation run sequentially

None of these dependencies are real. Each judge model, character, and segment is independent. The LLM provider has no rate limits.

Additionally, interleaved `console.log` output from concurrent operations makes the terminal unreadable during a run.

---

## Goal

- Eliminate all avoidable sequential LLM call chains across the evaluation pipeline
- Add a live progress display that stays readable during parallel execution
- Preserve full detail logs, flushed at completion or on crash

## Non-goals

- No concurrency cap / semaphore (no rate limits in play)
- No changes to dataset generation (already uses `Promise.all()` ✓)
- No changes to prompts, scoring, or output schemas
- No changes to the frontend

---

## Changes

### 1. `evaluation/judge/index.ts` — parallel judges

Replace the `for (const judgeConfig of judges)` loop with `Promise.all(judges.map(...))`.

Each judge call buffers its retry/result lines into a local `string[]`. The array is returned alongside the `JudgeResult` and flushed by the caller after all judges finish. Order of judge results in the output array is preserved (`Promise.all` preserves insertion order).

### 2. `evaluation/reconstruct/index.ts` — parallel characters and segments

**Characters:** Replace `for (const convChar of result.characters)` with `Promise.all(result.characters.map(...))`. Each character's full processing (all segments + internal consistency comparisons) runs concurrently.

**Segments:** Replace `for (const seg of segments)` with `Promise.all(segments.map(...))`. Each segment's reconstructor call and comparator calls run concurrently. `Promise.all` preserves array order, so `segmentFields[0]` (seg0) and `segmentFields[segmentFields.length - 1]` (segN) remain correct for the drift comparison.

Progress lines (`  [${alias}] reconstructing…`, `    [${field}] internal consistency…`) are buffered per character and flushed together after the character completes.

### 3. `evaluation/drift/index.ts` — parallel segments

Replace the `for (let segIdx = 0; segIdx < segments.length; segIdx++)` loop with `Promise.all(segments.map((segMessages, segIdx) => ...))`.

`turnOffset` (used to compute `firstTurn`/`lastTurn`) is derived from the segment index, not accumulated in a loop variable, so it is precomputed per segment: `firstTurn = segments.slice(0, segIdx).reduce((n, s) => n + s.length, 0) + 1`.

`priorMessages` is sliced from the original `realNameMessages` array using `firstTurn - 1`, which does not depend on any other segment's result. Safe to parallelize.

### 4. `evaluation/run_pipeline.ts` — parallel passes

Replace three sequential `await runXxxPass(...)` calls with `Promise.allSettled([runJudgingPass(...), runReconstructionPass(...), runDriftPass(...)])`.

Error handling:
- Each pass still cleans up its own output directory on failure (existing behavior in each `pass.ts`)
- The top-level eval directory is removed only if **all three** passes fail (existing rule, unchanged)
- Exit code is non-zero if any pass failed
- All three passes' errors are reported together at the end, not just the first one

This is strictly better than today: a drift failure no longer prevents judge and reconstruct results from being preserved.

---

## Output / Progress Display

All per-operation `console.log` / `process.stdout.write` calls inside a parallel unit (conversation, character, segment) are **buffered** into a local `string[]` and not written immediately.

A **live progress line** is written to stderr using `\r` (overwrite in place on TTY, plain newline on non-TTY), one line per pass:

```
  judge:        ✓ 12/15  ↻ 2 retries
  reconstruct:  ✓  8/15
  drift:        ✓ 15/15  done
```

Each counter increments as a conversation completes. When all 3 passes run concurrently, their progress lines update independently.

At the end of each pass: write `\n` to close the progress line, then flush all buffered detail logs in label order. On crash: flush the failed item's buffered logs before the error summary so the failure context is visible.

A shared `ProgressReporter` utility (new file: `evaluation/progress.ts`) handles the counter state and stderr writes, keeping the pattern consistent across all three passes.

---

## File Summary

| File | Change |
|------|--------|
| `evaluation/judge/index.ts` | `for` → `Promise.all`, buffer log lines per judge |
| `evaluation/reconstruct/index.ts` | `for` (characters) → `Promise.all`; `for` (segments) → `Promise.all`; buffer per-character output |
| `evaluation/drift/index.ts` | `for` (segments) → `Promise.all`; precompute `turnOffset` per segment |
| `evaluation/run_pipeline.ts` | sequential `await` → `Promise.allSettled`; unified error reporting |
| `evaluation/progress.ts` | new — `ProgressReporter` class for live progress line + buffered flush |

No other files change.

---

## Expected Impact

| Pass | Before | After |
|------|--------|-------|
| Judge (15 conv × 3 judges) | 15 groups × 3 sequential calls | 15 × 1 parallel group — wall-clock = slowest judge |
| Reconstruct (15 conv × N chars × N segments) | fully sequential chain | all independent units concurrent |
| Drift (15 conv × 2 segments) | 15 × 2 sequential | 15 × 1 parallel group |
| Pipeline total | sum of all 3 passes | max of all 3 passes |
