import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TOOL_DESCRIPTIONS, ConversationJobStatusSchema, type ConversationJobStatus } from "@open-ormus/shared";
import { userIdStorage } from "../../auth/context.js";
import { mintInternalToken } from "../../auth/internal-token.js";

const JobStatusInputShape = {
  jobId: z.string().uuid(),
};

export async function conversationJobStatusHandler(
  jobId: string
): Promise<ConversationJobStatus> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const token = mintInternalToken(userId);
  const baseUrl = process.env["FRONTEND_INTERNAL_URL"] ?? "http://localhost:3000";

  const res = await fetch(
    `${baseUrl}/api/internal/conversation-jobs/${jobId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (res.status === 404) throw new Error(`Job ${jobId} not found`);
  if (!res.ok) throw new Error(`Failed to get job status: ${res.status}`);

  const json: unknown = await res.json();
  const parsed = ConversationJobStatusSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid response from job status endpoint`);
  }
  return parsed.data;
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__conversation_job_status",
    TOOL_DESCRIPTIONS.conversation_job_status,
    JobStatusInputShape,
    async (args: { jobId: string }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await conversationJobStatusHandler(args.jobId)),
        },
      ],
    })
  );
}
