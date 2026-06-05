import OpenAI from "openai";
import { ReconstructorOutputSchema, ComparatorOutputSchema } from "./types";
import type { ReconstructorOutput, ComparatorOutput, ProfileField } from "./types";
import { buildReconstructorResponseFormat, comparatorResponseFormat } from "./schema";

const MAX_RETRIES = 3;

export async function callReconstructor(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  fields: ProfileField[],
  label: string,
): Promise<ReconstructorOutput> {
  const responseFormat = buildReconstructorResponseFormat(fields);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        stream: false,
        response_format: responseFormat,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
      });

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`); }

      return ReconstructorOutputSchema.parse(parsed);
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
): Promise<ComparatorOutput> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        stream: false,
        response_format: comparatorResponseFormat,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
      });

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`); }

      return ComparatorOutputSchema.parse(parsed);
    } catch (err) {
      lastError = err;
      process.stderr.write(`  [${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  throw new Error(`[${label}] all ${MAX_RETRIES} attempts failed. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
