import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  OpenAIChatCompletionsModel,
} from "@openai/agents";
import { createLLMClient } from "@/lib/llm-client";
import { logLlmUsage, type UsageContext } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";

export const MODEL_NAME = process.env["CONVERSATION_MODEL"] ?? "default";

const client = createLLMClient();

// One-time global SDK configuration. Run in chat-completions mode against the
// custom (OpenRouter) client; tracing is disabled — we log usage ourselves.
setDefaultOpenAIClient(client);
setOpenAIAPI("chat_completions");
setTracingDisabled(true);

type TokenDetails = Record<string, number> | Array<Record<string, number>>;

// `*TokensDetails` is either a single record or an array of records (provider
// dependent). Read a key from whichever form is present; undefined if absent.
function readTokenDetail(details: TokenDetails | undefined, key: string): number | undefined {
  if (details === undefined) return undefined;
  if (Array.isArray(details)) {
    for (const entry of details) {
      const value = entry[key];
      if (value !== undefined) return value;
    }
    return undefined;
  }
  return details[key];
}

type ResponseDoneEvent = {
  type: "response_done";
  response: {
    id: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      inputTokensDetails?: TokenDetails;
      outputTokensDetails?: TokenDetails;
    };
  };
};

function asResponseDone(event: unknown): ResponseDoneEvent | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const e = event as { type?: unknown };
  return e.type === "response_done" ? (event as ResponseDoneEvent) : undefined;
}

type StreamedRequest = Parameters<OpenAIChatCompletionsModel["getStreamedResponse"]>[0];
type StreamedResponse = ReturnType<OpenAIChatCompletionsModel["getStreamedResponse"]>;

// Wraps the chat-completions model so every underlying LLM call (each tool
// round produces its own `response_done`) emits exactly one usage row. The SDK
// only aggregates usage at the run level, which would lose per-call detail.
export class LoggingModel extends OpenAIChatCompletionsModel {
  private readonly ctx: UsageContext;

  constructor(ctx: UsageContext = { source: LlmUsageSource.AGENT_SESSION }) {
    super(client, MODEL_NAME);
    this.ctx = ctx;
  }

  override async *getStreamedResponse(request: StreamedRequest): StreamedResponse {
    const startTime = Date.now();
    for await (const event of super.getStreamedResponse(request)) {
      const done = asResponseDone(event);
      if (done) {
        const { usage, id } = done.response;
        const cachedTokens = readTokenDetail(usage.inputTokensDetails, "cached_tokens");
        const reasoningTokens = readTokenDetail(usage.outputTokensDetails, "reasoning_tokens");
        await logLlmUsage(this.ctx, {
          generationId: id,
          model: MODEL_NAME,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...(cachedTokens !== undefined ? { cachedTokens } : {}),
          ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
          latencyMs: Date.now() - startTime,
        });
      }
      yield event;
    }
  }
}
