// mcp_server/src/registry/tools/character_list.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";
import type { SavedCharacterRecord } from "@open-ormus/shared";
import { listCharacters } from "@open-ormus/shared/services/character.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

export async function characterListHandler(): Promise<SavedCharacterRecord[]> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");
  return listCharacters(prisma, userId);
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_list",
    TOOL_DESCRIPTIONS.character_list,
    {},
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(await characterListHandler()) }],
    })
  );
}
