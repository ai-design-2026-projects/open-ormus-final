import OpenAI from "openai";
import { parseJsonFromLlm } from "../utils";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

const MAX_RETRIES = 3;

export type ResponseFormat = { type: "json_object" };

export interface CallResult<T> {
  result: T;
  usage: RawUsageMeta | null;
}

export function formatRetryReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("returned empty content")) return "empty response";

  if (msg.startsWith("JSON parse failed")) {
    const start = msg.indexOf("{");
    const preview = start >= 0 ? ` — ${msg.slice(start, start + 80)}…` : "";
    return `JSON parse${preview}`;
  }

  if (msg.trimStart().startsWith("[")) {
    try {
      const errors = JSON.parse(msg) as Array<{ message?: string }>;
      return `schema: ${errors.map((e) => e.message ?? "unknown").join("; ")}`;
    } catch {}
  }

  const firstLine = (msg.split("\n")[0] ?? msg).slice(0, 100);
  return firstLine.length < msg.length ? firstLine + "…" : firstLine;
}

export async function callWithRetry<T>(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  responseFormat: ResponseFormat,
  parse: (raw: unknown) => T,
  label: string,
  log: (line: string) => void = (line) => process.stderr.write(line),
): Promise<CallResult<T>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const { data: stream, response: httpResponse } = await client.chat.completions
        .create({
          model,
          temperature: 0,
          stream: true,
          stream_options: { include_usage: true },
          response_format: responseFormat,
          messages,
          extra_headers: {
            "HTTP-Referer": "https://openormus.app",
            "X-Title": "OpenOrmus",
          },
        })
        .withResponse();

      let content = "";
      let streamUsage: OpenAI.CompletionUsage | null = null;
      let completionId = "";
      for await (const chunk of stream) {
        content += chunk.choices[0]?.delta?.content ?? "";
        if (chunk.usage) streamUsage = chunk.usage;
        if (chunk.id && !completionId) completionId = chunk.id;
      }

      if (!content) throw new Error(`${label} returned empty content on attempt ${attempt}`);

      let parsed: unknown;
      try {
        parsed = parseJsonFromLlm(content);
      } catch {
        throw new Error(`JSON parse failed. Raw response:\n${content}`);
      }

      const result = parse(parsed);
      const generationId = httpResponse.headers.get("x-generation-id") ?? completionId;
      const usage: RawUsageMeta | null = streamUsage
        ? {
            generationId,
            model,
            inputTokens: streamUsage.prompt_tokens,
            outputTokens: streamUsage.completion_tokens,
            reasoningTokens: streamUsage.completion_tokens_details?.reasoning_tokens ?? null,
            cachedTokens: streamUsage.prompt_tokens_details?.cached_tokens ?? null,
            latencyMs: Date.now() - startTime,
          }
        : null;

      return { result, usage };
    } catch (err) {
      lastError = err;
      log(`[${label}] (${model}) attempt ${attempt}/${MAX_RETRIES}: ${formatRetryReason(err)}\n`);
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[${label}] (${model}) all ${MAX_RETRIES} attempts failed. Last error: ${errMsg}`);
}
