import OpenAI from "openai";

export function createLLMClient(fetch?: typeof globalThis.fetch): OpenAI {
  return new OpenAI({
    baseURL: process.env["LLM_BASE_URL"] ?? "http://localhost:11434/v1",
    apiKey: process.env["LLM_API_KEY"] ?? "local",
    ...(fetch ? { fetch } : {}),
  });
}
