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
  archivedAt: Date | null;
}

// Structural interface satisfied by both frontend (lib/prisma.ts) and MCP (src/db.ts)
// PrismaClient instances. Avoids importing the generated client here.
interface PrismaLike {
  character: {
    findMany(args: {
      where: { userId: string; archivedAt: null };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<CharacterRow[]>;
    create(args: {
      data: { userId: string; name: string; sheet: InputJsonValue };
    }): Promise<CharacterRow>;
    updateMany(args: {
      where: { id: string; userId: string; archivedAt?: null };
      data: { name?: string; sheet?: InputJsonValue; archivedAt?: Date };
    }): Promise<{ count: number }>;
    findFirst(args: { where: { id: string; userId: string } }): Promise<CharacterRow | null>;
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
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function listCharacters(
  prisma: PrismaLike,
  userId: string
): Promise<SavedCharacterRecord[]> {
  const rows = await prisma.character.findMany({
    where: { userId, archivedAt: null },
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
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function updateCharacter(
  prisma: PrismaLike,
  userId: string,
  data: CharacterUpdateInput
): Promise<SavedCharacterRecord | { error: "not_found" } | { error: "archived" }> {
  const existing = await prisma.character.findFirst({ where: { id: data.id, userId } });
  if (!existing) return { error: "not_found" };
  if (existing.archivedAt !== null) return { error: "archived" };
  await prisma.character.updateMany({
    where: { id: data.id, userId, archivedAt: null },
    data: { name: data.sheet.name, sheet: data.sheet as unknown as InputJsonValue },
  });
  const row = await prisma.character.findFirst({ where: { id: data.id, userId } });
  if (row === null) return { error: "not_found" };
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: data.sheet,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function archiveCharacter(
  prisma: PrismaLike,
  userId: string,
  id: string
): Promise<{ success: true } | { error: "not_found" } | { error: "already_archived" }> {
  const result = await prisma.character.updateMany({
    where: { id, userId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (result.count === 0) {
    const existing = await prisma.character.findFirst({ where: { id, userId } });
    if (!existing) return { error: "not_found" };
    return { error: "already_archived" };
  }
  return { success: true };
}
