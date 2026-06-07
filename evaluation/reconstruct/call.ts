import OpenAI from "openai";
import { ReconstructorOutputSchema, ComparatorOutputSchema } from "./types";
import type { ReconstructorOutput, ComparatorOutput, ProfileField } from "./types";
import { buildReconstructorResponseFormat, comparatorResponseFormat } from "./schema";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";
import { parseJsonFromLlm } from "../utils";

const MAX_RETRIES = 3;

export async function callReconstructor(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  fields: ProfileField[],
  label: string,
): Promise<{ output: ReconstructorOutput; usage: RawUsageMeta | null }> {
  const responseFormat = buildReconstructorResponseFormat(fields);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const { data: response, response: httpResponse } = await client.chat.completions
        .create({
          model,
          temperature: 0,
          stream: false,
          response_format: responseFormat,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
        })
        .withResponse();

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try { parsed = parseJsonFromLlm(raw); }
      catch { throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`); }

      const output = ReconstructorOutputSchema.parse(parsed);
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
      process.stderr.write(`  [${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  throw new Error(`[${label}] all ${MAX_RETRIES} attempts failed. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function callComparator(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
): Promise<{ output: ComparatorOutput; usage: RawUsageMeta | null }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const { data: response, response: httpResponse } = await client.chat.completions
        .create({
          model,
          temperature: 0,
          stream: false,
          response_format: comparatorResponseFormat,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
        })
        .withResponse();

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try { parsed = parseJsonFromLlm(raw); }
      catch { throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`); }

      const output = ComparatorOutputSchema.parse(parsed);
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
      process.stderr.write(`  [${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  throw new Error(`[${label}] all ${MAX_RETRIES} attempts failed. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
