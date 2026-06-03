import type { InputJsonValue } from "@prisma/client/runtime/client";
import type {
  CharacterSaveInput,
  CharacterPicture,
  SavedCharacterRecord,
} from "../schema/character_saved";
import { CharacterSearchResultSchema } from "../schema/character_search";
import type { CharacterSearchResult } from "../schema/character_search";

interface CharacterRow {
  id: string;
  userId: string;
  name: string;
  sheet: unknown;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

interface PictureRow {
  characterId: string;
  size: number;
  url: string;
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
      data: { id?: string; userId: string; name: string; sheet: InputJsonValue };
    }): Promise<CharacterRow>;
    updateMany(args: {
      where: { id: string; userId: string; archivedAt?: null };
      data: { name?: string; sheet?: InputJsonValue; archivedAt?: Date };
    }): Promise<{ count: number }>;
    findFirst(args: { where: { id: string; userId: string } }): Promise<CharacterRow | null>;
  };
  characterPicture: {
    findMany(args: {
      where: { characterId: string } | { characterId: { in: string[] } };
    }): Promise<PictureRow[]>;
  };
}

function toRecord(row: CharacterRow, pictures: PictureRow[]): SavedCharacterRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: CharacterSearchResultSchema.parse(row.sheet),
    pictures: pictures.map((p) => ({ size: p.size, url: p.url })),
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
  if (rows.length === 0) return [];
  const characterIds = rows.map((r) => r.id);
  const allPictures = await prisma.characterPicture.findMany({
    where: { characterId: { in: characterIds } },
  });
  const picturesByChar = allPictures.reduce<Record<string, PictureRow[]>>((acc, p) => {
    (acc[p.characterId] ??= []).push(p);
    return acc;
  }, {});
  return rows.map((r) => toRecord(r, picturesByChar[r.id] ?? []));
}

export async function saveCharacter(
  prisma: PrismaLike,
  userId: string,
  data: Omit<CharacterSaveInput, "imageUrl">,
  pictures: CharacterPicture[] = [],
  id?: string
): Promise<SavedCharacterRecord> {
  const row = await prisma.character.create({
    data: {
      ...(id !== undefined ? { id } : {}),
      userId,
      name: data.name,
      sheet: data as unknown as InputJsonValue,
    },
  });
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: data as unknown as CharacterSearchResult,
    pictures,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function updateCharacter(
  prisma: PrismaLike,
  userId: string,
  data: { id: string; sheet: Omit<CharacterSearchResult, "imageUrl"> }
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
  const pictures = await prisma.characterPicture.findMany({ where: { characterId: data.id } });
  return toRecord(row, pictures);
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
