// mcp_server/src/registry/tools/character_delete.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterDeleteInputShape,
  TOOL_DESCRIPTIONS,
  type CharacterDeleteInput,
} from "@open-ormus/shared";
import { archiveCharacter } from "@open-ormus/shared/services/character.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type ArchiveResult =
  | { success: true }
  | { error: "not_found" }
  | { error: "already_archived" };

export async function characterDeleteHandler(
  args: CharacterDeleteInput
): Promise<ArchiveResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");
  return archiveCharacter(prisma, userId, args.id);
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_delete",
    TOOL_DESCRIPTIONS.character_delete,
    CharacterDeleteInputShape,
    async (args: CharacterDeleteInput) => {
      const result = await characterDeleteHandler(args);
      let text: string;
      if ("error" in result) {
        text =
          result.error === "not_found"
            ? "Character not found."
            : "Character already archived.";
      } else {
        text = JSON.stringify(result);
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
