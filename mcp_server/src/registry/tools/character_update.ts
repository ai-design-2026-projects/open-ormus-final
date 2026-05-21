// mcp_server/src/registry/tools/character_update.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterUpdateInputShape,
  type CharacterUpdateInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { updateCharacter } from "@open-ormus/shared/services/character.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type UpdateResult = SavedCharacterRecord | { error: "not_found" } | { error: "archived" };

export async function characterUpdateHandler(
  args: CharacterUpdateInput
): Promise<UpdateResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");
  return updateCharacter(prisma, userId, args);
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_update",
    "Update a saved character's full profile. Replaces the existing sheet entirely.",
    CharacterUpdateInputShape,
    async (args: CharacterUpdateInput) => {
      const result = await characterUpdateHandler(args);
      let text: string;
      if ("error" in result) {
        text =
          result.error === "archived"
            ? "Character is archived and cannot be modified."
            : "Character not found.";
      } else {
        text = JSON.stringify(result);
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
