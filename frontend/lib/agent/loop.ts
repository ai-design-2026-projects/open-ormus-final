import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ToolResultBlockParam,
  ContentBlock,
} from "@anthropic-ai/sdk/resources/messages";
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

function extractTextContent(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Runs the main agent loop for one user turn.
 * Calls onChunk for each SSE byte payload and returns history + assistant output.
 *
 * @param priorMessages - Rehydrated MessageParam[] from AgentTurn history
 * @param userMessage   - The new user message text
 * @param mcpSession    - Initialized MCP session (call initMcpSession first)
 * @param onChunk       - Called with each encoded SSE Uint8Array chunk
 * @returns Updated messages array, final assistant text, and raw content blocks
 */
export async function runAgentLoop(
  priorMessages: MessageParam[],
  userMessage: string,
  mcpSession: McpSession,
  onChunk: (data: Uint8Array) => void,
): Promise<{ messages: MessageParam[]; assistantText: string; toolCallsJson: unknown }> {
  const client = new Anthropic({
    baseURL: process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000",
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "local",
  });

  const send = (chunk: Parameters<typeof encodeChunk>[0]) => {
    onChunk(encodeChunk(chunk));
  };

  const messages: MessageParam[] = [
    ...priorMessages,
    { role: "user", content: userMessage },
  ];

  const tools = [...buildMcpTools(), researchShowTool, researchCharacterBasicsTool, researchCharacterDetailsTool, wizardTool];

  let assistantText = "";
  let lastAssistantContent: ContentBlock[] = [];

  while (true) {
    const stream = client.messages.stream({
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      max_tokens: 4096,
      system: AGENT_SYSTEM_PROMPT,
      tools,
      messages,
    });

    stream.on("text", (text) => {
      assistantText += text;
      send({ type: "text_delta", text });
    });

    const finalMessage = await stream.finalMessage();
    lastAssistantContent = finalMessage.content;
    messages.push({ role: "assistant", content: finalMessage.content });

    if (finalMessage.stop_reason !== "tool_use") break;

    const toolResults: ToolResultBlockParam[] = [];

    for (const block of finalMessage.content) {
      if (block.type !== "tool_use") continue;

      send({ type: "tool_start", tool: block.name, input: block.input });

      let result: unknown;
      try {
        if (block.name === "research_show_online") {
          const input = block.input as { query: string };
          result = await handleShowResearch(input);
        } else if (block.name === "research_character_basics") {
          const input = block.input as { query: string };
          result = await handleCharacterBasicsResearch(input);
        } else if (block.name === "research_character_details") {
          const parsed = CharacterDetailsResearchInputSchema.safeParse(block.input);
          if (!parsed.success) {
            result = { error: "invalid_input", details: parsed.error.format() };
          } else {
            result = await handleCharacterDetailsResearch(parsed.data);
          }
        } else if (block.name === "start_character_wizard") {
          result = handleWizard();
        } else {
          result = await callMcpTool(
            mcpSession,
            block.name,
            block.input as Record<string, unknown>,
          );
        }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : "tool_call_failed" };
      }

      const preview = JSON.stringify(result).slice(0, 300);
      send({ type: "tool_result", tool: block.name, preview });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    messages,
    assistantText: extractTextContent(lastAssistantContent),
    toolCallsJson: lastAssistantContent,
  };
}
