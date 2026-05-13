import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterDeleteInputShape,
  type CharacterDeleteInput,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type DeleteResult = { success: true } | { error: "not_found" };

export async function characterDeleteHandler(
  args: CharacterDeleteInput
): Promise<DeleteResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const result = await prisma.character.deleteMany({
    where: { id: args.id, userId },
  });
  if (result.count === 0) return { error: "not_found" };

  return { success: true };
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_delete",
    "Delete a saved character from your collection by id.",
    CharacterDeleteInputShape,
    async (args: CharacterDeleteInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterDeleteHandler(args)),
        },
      ],
    })
  );
}
