// mcp_server/src/registry/tools/character_delete.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterDeleteInputShape,
  type CharacterDeleteInput,
} from "@open-ormus/shared";
import { deleteCharacter } from "@open-ormus/shared/services/character.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type DeleteResult = { success: true } | { error: "not_found" };

export async function characterDeleteHandler(
  args: CharacterDeleteInput
): Promise<DeleteResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");
  return deleteCharacter(prisma, userId, args.id);
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_delete",
    "Delete a saved character from your collection by id.",
    CharacterDeleteInputShape,
    async (args: CharacterDeleteInput) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await characterDeleteHandler(args)) }],
    })
  );
}
