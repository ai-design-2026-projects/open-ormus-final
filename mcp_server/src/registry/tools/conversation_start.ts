import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  TOOL_DESCRIPTIONS,
  ConversationStartInputShape,
  type ConversationStartInput,
} from "@open-ormus/shared";
import { userIdStorage } from "../../auth/context.js";
import { mintInternalToken } from "../../auth/internal-token.js";

export async function conversationStartHandler(
  args: ConversationStartInput
): Promise<{ conversationId: string; jobId: string }> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const token = mintInternalToken(userId);
  const baseUrl = process.env["FRONTEND_INTERNAL_URL"] ?? "http://localhost:3000";

  const res = await fetch(`${baseUrl}/api/internal/conversation-jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Failed to start conversation: ${res.status} ${JSON.stringify(body)}`
    );
  }

  const json: unknown = await res.json();
  if (
    typeof json !== "object" ||
    json === null ||
    typeof (json as Record<string, unknown>)["conversationId"] !== "string" ||
    typeof (json as Record<string, unknown>)["jobId"] !== "string"
  ) {
    throw new Error("Invalid response from conversation start endpoint");
  }
  return json as { conversationId: string; jobId: string };
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__conversation_start",
    TOOL_DESCRIPTIONS.conversation_start,
    ConversationStartInputShape,
    async (args: ConversationStartInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await conversationStartHandler(args)),
        },
      ],
    })
  );
}
