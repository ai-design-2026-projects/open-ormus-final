import OpenAI from "openai";
import { JudgeOutputSchema } from "./types";
import type { JudgeOutput } from "./types";
import { judgeGuessingResponseFormat } from "./schema";
import { callWithRetry } from "../shared/call";
import type { CallResult } from "../shared/call";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

export async function callJudge(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  judgeLabel: string,
  log: (line: string) => void,
): Promise<{ output: JudgeOutput; usage: RawUsageMeta | null }> {
  const { result, usage }: CallResult<JudgeOutput> = await callWithRetry(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    judgeGuessingResponseFormat,
    (raw) => JudgeOutputSchema.parse(raw),
    judgeLabel,
    (line) => log(line.replace(/\n$/, "")),
  );
  return { output: result, usage };
}
