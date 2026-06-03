import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { CharacterPicture } from "../schema/character_saved";

const SIZES = [48, 128, 512] as const;
const BUCKET = "character-pictures";

interface PrismaWithPictures {
  characterPicture: {
    upsert(args: {
      where: { characterId_size: { characterId: string; size: number } };
      update: { url: string; storagePath: string };
      create: {
        id: string;
        userId: string;
        characterId: string;
        size: number;
        url: string;
        storagePath: string;
      };
    }): Promise<{ id: string; size: number; url: string; storagePath: string }>;
    deleteMany(args: { where: { characterId: string } }): Promise<{ count: number }>;
  };
}

export async function processAndStorePicturesFromBuffer(
  prismaLike: PrismaWithPictures,
  buffer: Buffer,
  userId: string,
  characterId: string,
  config: { supabaseUrl: string; supabaseServiceRoleKey: string }
): Promise<CharacterPicture[]> {
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const results: CharacterPicture[] = [];

  for (const size of SIZES) {
    const processed = await sharp(buffer)
      .resize(size, size, { fit: "cover" })
      .webp()
      .toBuffer();

    const storagePath = `${userId}/${characterId}/${size}.webp`;
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, processed, {
      contentType: "image/webp",
      upsert: true,
    });
    if (error) throw new Error(`Storage upload failed for size ${size}: ${error.message}`);

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    // Append version to bust CDN/browser cache when the same path is overwritten
    const url = `${publicUrl}?v=${Date.now()}`;

    await prismaLike.characterPicture.upsert({
      where: { characterId_size: { characterId, size } },
      update: { url, storagePath },
      create: { id: randomUUID(), userId, characterId, size, url, storagePath },
    });

    results.push({ size, url });
  }

  return results;
}

export async function processAndStorePictures(
  prismaLike: PrismaWithPictures,
  sourceUrl: string,
  userId: string,
  characterId: string,
  config: { supabaseUrl: string; supabaseServiceRoleKey: string }
): Promise<CharacterPicture[]> {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Image fetch failed: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) throw new Error(`Not an image: ${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return processAndStorePicturesFromBuffer(prismaLike, buffer, userId, characterId, config);
}

export async function deletePictures(
  prismaLike: PrismaWithPictures,
  userId: string,
  characterId: string,
  config: { supabaseUrl: string; supabaseServiceRoleKey: string }
): Promise<void> {
  await prismaLike.characterPicture.deleteMany({ where: { characterId } });
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const paths = SIZES.map((size) => `${userId}/${characterId}/${size}.webp`);
  await supabase.storage.from(BUCKET).remove(paths);
}
