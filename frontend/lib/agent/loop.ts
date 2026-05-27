import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
} from "openai/resources/chat/completions";
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

type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: { type: string; properties?: Record<string, unknown>; required?: string[] };
};

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
): Promise<{ messages: ChatCompletionMessageParam[]; assistantText: string; toolCallsJson: unknown }> {
  const client = new OpenAI({
    baseURL: process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000",
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "local",
  });

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
  let lastToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

  while (true) {
    const stream = client.chat.completions.stream({
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      max_tokens: 4096,
      messages: [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        ...messages,
      ],
      tools,
    });

    stream.on("content", (_delta, snapshot) => {
      const newText = snapshot.slice(assistantText.length);
      if (newText) {
        assistantText += newText;
        send({ type: "text_delta", text: newText });
      }
    });

    const finalMessage = await stream.finalChatCompletion();
    const choice = finalMessage.choices[0];
    if (!choice) break;

    const assistantMessage = choice.message;
    messages.push(assistantMessage as ChatCompletionMessageParam);

    if (choice.finish_reason !== "tool_calls") break;

    const toolCalls = assistantMessage.tool_calls ?? [];
    lastToolCalls = toolCalls;
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
