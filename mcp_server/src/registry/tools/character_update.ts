// mcp_server/src/registry/tools/character_update.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterUpdateInputShape,
  TOOL_DESCRIPTIONS,
  type CharacterUpdateInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { updateCharacter } from "@open-ormus/shared/services/character.service";
import { processAndStorePictures } from "@open-ormus/shared/services/character_picture.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type UpdateResult = SavedCharacterRecord | { error: "not_found" } | { error: "archived" };

export async function characterUpdateHandler(
  args: CharacterUpdateInput
): Promise<UpdateResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const { id, imageUrl, sheet } = args;

  if (imageUrl) {
    await processAndStorePictures(
      prisma,
      imageUrl,
      userId,
      id,
      {
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      }
    );
    // throws on failure — update is not applied if picture processing fails
  }

  const { imageUrl: _stripped, ...sheetData } = sheet;
  return updateCharacter(prisma, userId, { id, sheet: sheetData });
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_update",
    TOOL_DESCRIPTIONS.character_update,
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
