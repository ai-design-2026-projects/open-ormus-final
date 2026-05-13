import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterSearchResultSchema,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

export async function characterListHandler(): Promise<SavedCharacterRecord[]> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const records = await prisma.character.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return records.map((record) => ({
    id: record.id,
    userId: record.userId,
    name: record.name,
    sheet: CharacterSearchResultSchema.parse(record.sheet),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }));
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_list",
    "List all characters saved in your collection.",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterListHandler()),
        },
      ],
    })
  );
}
