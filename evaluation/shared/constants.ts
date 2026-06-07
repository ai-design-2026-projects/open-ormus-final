export const PASS_DIRS = {
  judge: "judge_guessing",
  reconstruct: "reconstruct_persona",
  drift: "context_drift",
} as const;

export const DRIFT_THRESHOLD_DEGRADING = -0.25;
export const DRIFT_THRESHOLD_IMPROVING = 0.25;

export const COST_RETRY_DELAYS_MS = [3000, 6000, 12000] as const;
