import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  CharacterUpdateInputSchema,
  CharacterArchiveInputSchema,
  updateCharacter,
  archiveCharacter,
} from "@open-ormus/shared";
import { processAndStorePictures } from "@open-ormus/shared/services/character_picture.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CharacterUpdateInputSchema.safeParse(
    typeof body === "object" && body !== null ? { ...body, id } : { id }
  );
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const { imageUrl, sheet } = parsed.data;

  if (imageUrl) {
    try {
      await processAndStorePictures(
        prisma,
        imageUrl,
        user.id,
        id,
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

  const { imageUrl: _stripped, ...sheetData } = sheet;

  try {
    const result = await updateCharacter(prisma, user.id, { id, sheet: sheetData });
    if ("error" in result) {
      const status = result.error === "archived" ? 409 : 404;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const idParsed = CharacterArchiveInputSchema.safeParse({ id });
  if (!idParsed.success)
    return NextResponse.json({ error: idParsed.error.issues }, { status: 400 });

  try {
    const result = await archiveCharacter(prisma, user.id, idParsed.data.id);
    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
