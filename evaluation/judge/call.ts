import OpenAI from "openai";
import { JudgeOutputSchema } from "./types";
import type { JudgeOutput } from "./types";
import { judgeResponseFormat } from "./schema";

const MAX_RETRIES = 3;

export async function callJudge(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  judgeLabel: string,
): Promise<JudgeOutput> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
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
      });

      const raw = response.choices[0]?.message.content;
      if (!raw) {
        throw new Error(`${judgeLabel} returned empty content on attempt ${attempt}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`JSON parse failed. Raw response:\n${raw}`);
      }

      try {
        return JudgeOutputSchema.parse(parsed);
      } catch (zodErr) {
        throw new Error(
          `Schema validation failed. Model returned:\n${raw}\nErrors: ${zodErr instanceof Error ? zodErr.message : String(zodErr)}`
        );
      }
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `  [${judgeLabel}] attempt ${attempt}/${MAX_RETRIES} failed: ${msg}\n`,
      );
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[${judgeLabel}] all ${MAX_RETRIES} attempts failed. Last error: ${errMsg}`);
}
