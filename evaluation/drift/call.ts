import OpenAI from "openai";
import { JudgeOutputSchema } from "./types";
import { driftResponseFormat } from "./schema";
import type { JudgeOutput } from "./types";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";
import { callWithRetry } from "../shared/call";
import type { CallResult } from "../shared/call";

export async function callJudge(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
  log?: (line: string) => void,
): Promise<{ output: JudgeOutput; usage: RawUsageMeta | null }> {
  const { result, usage }: CallResult<JudgeOutput> = await callWithRetry(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    driftResponseFormat,
    (raw) => JudgeOutputSchema.parse(raw),
    label,
    log,
  );
  return { output: result, usage };
}
