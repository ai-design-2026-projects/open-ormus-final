import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  CharacterSaveInputSchema,
  listCharacters,
  saveCharacter,
  type CharacterPicture,
} from "@open-ormus/shared";
import { processAndStorePictures } from "@open-ormus/shared/services/character_picture.service";
import { randomUUID } from "crypto";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const characters = await listCharacters(prisma, user.id);
    return NextResponse.json(characters);
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CharacterSaveInputSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const { imageUrl, ...sheetData } = parsed.data;

  let pictures: CharacterPicture[] = [];
  let characterId: string | undefined;

  if (imageUrl) {
    characterId = randomUUID();
    try {
      pictures = await processAndStorePictures(
        prisma,
        imageUrl,
        user.id,
        characterId,
        {
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        }
      );
    } catch (err) {
      return NextResponse.json(
        { error: `Picture processing failed: ${String(err)}` },
        { status: 422 }
      );
    }
  }

  try {
    const character = await saveCharacter(prisma, user.id, sheetData, pictures, characterId);
    return NextResponse.json(character, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
