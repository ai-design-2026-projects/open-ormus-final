import OpenAI from "openai";
import { JudgeOutputSchema } from "./types";
import type { JudgeOutput } from "./types";
import { judgeResponseFormat } from "./schema";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";
import { parseJsonFromLlm } from "../utils";

const MAX_RETRIES = 3;

function formatRetryReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("returned empty content")) return "empty response";

  if (msg.startsWith("JSON parse failed")) {
    const start = msg.indexOf("{");
    const preview = start >= 0 ? ` — ${msg.slice(start, start + 80)}…` : "";
    return `JSON parse${preview}`;
  }

  // Zod throws a JSON array of error objects
  if (msg.trimStart().startsWith("[")) {
    try {
      const errors = JSON.parse(msg) as Array<{ message?: string }>;
      const messages = errors.map((e) => e.message ?? "unknown").join("; ");
      return `schema: ${messages}`;
    } catch {}
  }

  const firstLine = (msg.split("\n")[0] ?? msg).slice(0, 100);
  return firstLine.length < msg.length ? firstLine + "…" : firstLine;
}

export async function callJudge(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  judgeLabel: string,
  log: (line: string) => void,
): Promise<{ output: JudgeOutput; usage: RawUsageMeta | null }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const { data: response, response: httpResponse } = await client.chat.completions
        .create({
          model,
          temperature: 0,
          stream: false,
          response_format: judgeResponseFormat,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          extra_headers: {
            "HTTP-Referer": "https://openormus.app",
            "X-Title": "OpenOrmus",
          },
        })
        .withResponse();

      const raw = response.choices[0]?.message.content;
      if (!raw) {
        throw new Error(`${judgeLabel} returned empty content on attempt ${attempt}`);
      }

      let parsed: unknown;
      try {
        parsed = parseJsonFromLlm(raw);
      } catch {
        throw new Error(`JSON parse failed. Raw response:\n${raw}`);
      }

      const output = JudgeOutputSchema.parse(parsed);
      const generationId = httpResponse.headers.get("x-generation-id") ?? response.id;
      const usage: RawUsageMeta | null = response.usage
        ? {
            generationId,
            model,
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? null,
            cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? null,
            latencyMs: Date.now() - startTime,
          }
        : null;

      return { output, usage };
    } catch (err) {
      lastError = err;
      log(`attempt ${attempt}/${MAX_RETRIES}: ${formatRetryReason(err)}`);
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[${judgeLabel}] all ${MAX_RETRIES} attempts failed. Last error: ${errMsg}`);
}
