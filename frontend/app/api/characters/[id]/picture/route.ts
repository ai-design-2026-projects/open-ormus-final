import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  processAndStorePicturesFromBuffer,
  deletePictures,
} from "@open-ormus/shared/services/character_picture.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CONFIG = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
};

export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const owned = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file field required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "file must be an image" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const pictures = await processAndStorePicturesFromBuffer(
      prisma,
      buffer,
      user.id,
      id,
      CONFIG
    );
    const updated = await prisma.character.findFirst({ where: { id, userId: user.id } });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      id: updated.id,
      userId: updated.userId,
      name: updated.name,
      sheet: updated.sheet,
      pictures,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      archivedAt: updated.archivedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Picture processing failed: ${String(err)}` },
      { status: 422 }
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const owned = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deletePictures(prisma, user.id, id, CONFIG);
  return new NextResponse(null, { status: 204 });
}
