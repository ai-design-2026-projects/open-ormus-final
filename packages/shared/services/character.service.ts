import type { InputJsonValue } from "@prisma/client/runtime/client";
import type {
  CharacterSaveInput,
  CharacterUpdateInput,
  SavedCharacterRecord,
} from "../schema/character_saved";
import { CharacterSearchResultSchema } from "../schema/character_search";

interface CharacterRow {
  id: string;
  userId: string;
  name: string;
  sheet: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// Structural interface satisfied by both frontend (lib/prisma.ts) and MCP (src/db.ts)
// PrismaClient instances. Avoids importing the generated client here.
interface PrismaLike {
  character: {
    findMany(args: {
      where: { userId: string };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<CharacterRow[]>;
    create(args: {
      data: { userId: string; name: string; sheet: InputJsonValue };
    }): Promise<CharacterRow>;
    updateMany(args: {
      where: { id: string; userId: string };
      data: { name: string; sheet: InputJsonValue };
    }): Promise<{ count: number }>;
    findFirst(args: { where: { id: string; userId: string } }): Promise<CharacterRow | null>;
    deleteMany(args: {
      where: { id: string; userId: string };
    }): Promise<{ count: number }>;
  };
}

function toRecord(row: CharacterRow): SavedCharacterRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: CharacterSearchResultSchema.parse(row.sheet),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCharacters(
  prisma: PrismaLike,
  userId: string
): Promise<SavedCharacterRecord[]> {
  const rows = await prisma.character.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRecord);
}

export async function saveCharacter(
  prisma: PrismaLike,
  userId: string,
  data: CharacterSaveInput
): Promise<SavedCharacterRecord> {
  const row = await prisma.character.create({
    data: { userId, name: data.name, sheet: data as unknown as InputJsonValue },
  });
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateCharacter(
  prisma: PrismaLike,
  userId: string,
  data: CharacterUpdateInput
): Promise<SavedCharacterRecord | { error: "not_found" }> {
  const updated = await prisma.character.updateMany({
    where: { id: data.id, userId },
    data: { name: data.sheet.name, sheet: data.sheet as unknown as InputJsonValue },
  });
  if (updated.count === 0) return { error: "not_found" };
  const row = await prisma.character.findFirst({ where: { id: data.id, userId } });
  if (row === null) return { error: "not_found" };
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: data.sheet,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function deleteCharacter(
  prisma: PrismaLike,
  userId: string,
  id: string
): Promise<{ success: true } | { error: "not_found" }> {
  const result = await prisma.character.deleteMany({
    where: { id, userId },
  });
  if (result.count === 0) return { error: "not_found" };
  return { success: true };
}
