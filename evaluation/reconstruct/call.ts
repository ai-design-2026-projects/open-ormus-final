import OpenAI from "openai";
import { ReconstructorOutputSchema, ComparatorOutputSchema } from "./types";
import type { ReconstructorOutput, ComparatorOutput } from "./types";
import { reconstructorResponseFormat, comparatorResponseFormat } from "./schema";
import { callWithRetry } from "../shared/call";
import type { CallResult } from "../shared/call";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

export async function callReconstructor(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
  log?: (line: string) => void,
): Promise<{ output: ReconstructorOutput; usage: RawUsageMeta | null }> {
  const { result, usage }: CallResult<ReconstructorOutput> = await callWithRetry(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    reconstructorResponseFormat,
    (raw) => ReconstructorOutputSchema.parse(raw),
    label,
    log,
  );
  return { output: result, usage };
}

export async function callComparator(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
  log?: (line: string) => void,
): Promise<{ output: ComparatorOutput; usage: RawUsageMeta | null }> {
  const { result, usage }: CallResult<ComparatorOutput> = await callWithRetry(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    comparatorResponseFormat,
    (raw) => ComparatorOutputSchema.parse(raw),
    label,
    log,
  );
  return { output: result, usage };
}
