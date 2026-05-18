import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CharacterUpdateInputSchema, CharacterDeleteInputSchema, updateCharacter, deleteCharacter } from "@open-ormus/shared";

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
  // Merge the route param `id` into the body so CharacterUpdateInputSchema validates both
  const parsed = CharacterUpdateInputSchema.safeParse(
    typeof body === "object" && body !== null ? { ...body, id } : { id }
  );
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  try {
    const result = await updateCharacter(prisma, user.id, parsed.data);
    if ("error" in result)
      return NextResponse.json({ error: result.error }, { status: 404 });
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
  const idParsed = CharacterDeleteInputSchema.safeParse({ id });
  if (!idParsed.success)
    return NextResponse.json({ error: idParsed.error.issues }, { status: 400 });
  try {
    const result = await deleteCharacter(prisma, user.id, idParsed.data.id);
    if ("error" in result)
      return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
