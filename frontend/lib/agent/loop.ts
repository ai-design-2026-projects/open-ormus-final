import type {
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources";
import { createLLMClient } from "@/lib/llm-client";
import type { AnthropicTool } from "./types";
import { logLlmUsage, type UsageContext } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";
import { encodeChunk } from "./stream";
import type { McpSession } from "./mcp_bridge";
import { buildMcpTools, callMcpTool } from "./mcp_bridge";
import {
  handleShowResearch,
  researchShowTool,
  handleCharacterBasicsResearch,
  researchCharacterBasicsTool,
  handleCharacterDetailsResearch,
  researchCharacterDetailsTool,
  CharacterDetailsResearchInputSchema,
} from "./tools/exa_research";
import { handleWizard, wizardTool } from "./tools/wizard";
import { AGENT_SYSTEM_PROMPT } from "./prompt";

function toOpenAITool(t: AnthropicTool): ChatCompletionFunctionTool {
  const fn: ChatCompletionFunctionTool["function"] = {
    name: t.name,
    parameters: t.input_schema as Record<string, unknown>,
  };
  if (t.description !== undefined) fn.description = t.description;
  return { type: "function", function: fn };
}

/**
 * Runs the main agent loop for one user turn.
 * Calls onChunk for each SSE byte payload and returns history + assistant output.
 *
 * @param priorMessages - Rehydrated ChatCompletionMessageParam[] from AgentTurn history
 * @param userMessage   - The new user message text
 * @param mcpSession    - Initialized MCP session (call initMcpSession first)
 * @param onChunk       - Called with each encoded SSE Uint8Array chunk
 * @returns Updated messages array, final assistant text, and raw tool calls JSON
 */
export async function runAgentLoop(
  priorMessages: ChatCompletionMessageParam[],
  userMessage: string,
  mcpSession: McpSession,
  onChunk: (data: Uint8Array) => void,
  ctx: UsageContext = { source: LlmUsageSource.AGENT_SESSION },
): Promise<{ messages: ChatCompletionMessageParam[]; assistantText: string; toolCallsJson: unknown }> {
  const client = createLLMClient();

  const send = (chunk: Parameters<typeof encodeChunk>[0]) => {
    onChunk(encodeChunk(chunk));
  };

  const messages: ChatCompletionMessageParam[] = [
    ...priorMessages,
    { role: "user", content: userMessage },
  ];

  const anthropicTools: AnthropicTool[] = [
    ...(buildMcpTools() as AnthropicTool[]),
    researchShowTool as AnthropicTool,
    researchCharacterBasicsTool as AnthropicTool,
    researchCharacterDetailsTool as AnthropicTool,
    wizardTool as AnthropicTool,
  ];
  const tools = anthropicTools.map(toOpenAITool);

  let assistantText = "";
  let lastToolCalls: ChatCompletionMessageFunctionToolCall[] = [];

  while (true) {
    const iterStartTime = Date.now();
    const { data: rawStream, response: llmResponse } = await client.chat.completions.create(
      {
        model: process.env["CONVERSATION_MODEL"] ?? "default",
        max_tokens: 4096,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: AGENT_SYSTEM_PROMPT },
          ...messages,
        ],
        tools,
      },
    ).withResponse();

    // Prefer the x-generation-id response header for cost tracking — chunk.id
    // may refer to an internal streaming session ID that differs from what
    // OpenRouter's /api/v1/generation endpoint indexes.
    const headerGenerationId = llmResponse.headers.get("x-generation-id");
    console.log("[loop.ts] x-generation-id header:", headerGenerationId);

    // Accumulate the assistant response from raw streaming chunks.
    let iterGenerationId = headerGenerationId ?? "";
    let iterContent = "";
    let iterFinishReason: string | null = null;
    let iterUsage: CompletionUsage | null = null;
    const iterToolCallsMap = new Map<number, ChatCompletionMessageFunctionToolCall>();

    for await (const chunk of rawStream) {
      if (!iterGenerationId) iterGenerationId = chunk.id;
      if (chunk.usage) iterUsage = chunk.usage;

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        iterContent += delta.content;
        send({ type: "text_delta", text: delta.content });
      }

      for (const dtc of delta.tool_calls ?? []) {
        const idx = dtc.index;
        if (!iterToolCallsMap.has(idx)) {
          iterToolCallsMap.set(idx, {
            id: dtc.id ?? "",
            type: "function",
            function: { name: dtc.function?.name ?? "", arguments: "" },
          });
        }
        const tc = iterToolCallsMap.get(idx)!;
        if (dtc.function?.arguments) tc.function.arguments += dtc.function.arguments;
      }

      if (chunk.choices[0]?.finish_reason) {
        iterFinishReason = chunk.choices[0].finish_reason;
      }
    }

    assistantText = iterContent;

    const iterCachedTokens = iterUsage?.prompt_tokens_details?.cached_tokens;
    const iterReasoningTokens = iterUsage?.completion_tokens_details?.reasoning_tokens;
    await logLlmUsage(ctx, {
      generationId: iterGenerationId,
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      inputTokens: iterUsage?.prompt_tokens ?? 0,
      outputTokens: iterUsage?.completion_tokens ?? 0,
      ...(iterCachedTokens !== undefined ? { cachedTokens: iterCachedTokens } : {}),
      ...(iterReasoningTokens !== undefined ? { reasoningTokens: iterReasoningTokens } : {}),
      latencyMs: Date.now() - iterStartTime,
    });

    if (iterFinishReason === null) break;

    const toolCalls = Array.from(iterToolCallsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, tc]) => tc);

    const assistantMessage: ChatCompletionMessageParam = {
      role: "assistant",
      content: iterContent || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    messages.push(assistantMessage);

    if (iterFinishReason !== "tool_calls") break;

    const toolResults: ChatCompletionMessageParam[] = [];

    for (const toolCall of toolCalls) {
      const name = toolCall.function.name;
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        input = {};
      }

      send({ type: "tool_start", tool: name, input });

      let result: unknown;
      try {
        if (name === "research_show_online") {
          result = await handleShowResearch(input as { query: string });
        } else if (name === "research_character_basics") {
          result = await handleCharacterBasicsResearch(input as { query: string });
        } else if (name === "research_character_details") {
          const parsed = CharacterDetailsResearchInputSchema.safeParse(input);
          if (!parsed.success) {
            result = { error: "invalid_input", details: parsed.error.format() };
          } else {
            result = await handleCharacterDetailsResearch(parsed.data);
          }
        } else if (name === "start_character_wizard") {
          result = handleWizard();
        } else {
          result = await callMcpTool(mcpSession, name, input);
        }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : "tool_call_failed" };
      }

      const preview = JSON.stringify(result).slice(0, 300);
      send({ type: "tool_result", tool: name, preview });

      toolResults.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    messages.push(...toolResults);
  }

  return {
    messages,
    assistantText,
    toolCallsJson: lastToolCalls,
  };
}
