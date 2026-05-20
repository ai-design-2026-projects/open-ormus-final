import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { ImproveContextInputSchema, CharacterSearchResultSchema } from "@open-ormus/shared";

const SYSTEM_PROMPT = `You are a creative writing assistant specializing in fictional scene-setting.
Your task: improve a scene context description for a roleplay/story simulation.

Rules:
- If the input is sparse (fewer than 3 sentences or note-form): expand into a vivid, atmospheric paragraph
- If the input is a longer draft: polish prose, fix inconsistencies, improve narrative flow
- Preserve all factual details and character names from the original
- Output ONLY the improved text — no explanation, no preamble, no quotes`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ImproveContextInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { draft, characterIds } = parsed.data;

  const characters = await prisma.character.findMany({
    where: { id: { in: characterIds }, userId: user.id },
    select: { name: true, sheet: true },
  });

  const characterLines = characters.map((ch) => {
    const sheetParsed = CharacterSearchResultSchema.safeParse(ch.sheet);
    if (!sheetParsed.success) return `- ${ch.name}`;
    const { personalityTraits, backstory } = sheetParsed.data.personality;
    const traits = personalityTraits.slice(0, 3).join(", ");
    return `- ${ch.name}: ${traits}. ${backstory}`;
  });

  const userMessage =
    characterLines.length > 0
      ? `Characters in this scene:\n${characterLines.join("\n")}\n\nScene context draft:\n${draft}`
      : `Scene context draft:\n${draft}`;

  const client = new Anthropic({
    baseURL: process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000",
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "local",
  });
  const model = process.env["CONVERSATION_MODEL"];
  if (!model) {
    return NextResponse.json({ error: "CONVERSATION_MODEL env var not set" }, { status: 500 });
  }

  const start = Date.now();
  let improved = "";
  let llmError: string | null = null;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 1,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    improved = textBlock?.type === "text" ? textBlock.text.trim() : "";
  } catch (err) {
    llmError = String(err);
  } finally {
    process.stderr.write(
      JSON.stringify({
        session_id: crypto.randomUUID(),
        component: "improve-context",
        event: llmError != null ? "error" : "complete",
        userId: user.id,
        model,
        temperature: 1,
        prompt_hash: createHash("sha256").update(draft).digest("hex").slice(0, 8),
        latency_ms: Date.now() - start,
        ...(llmError != null ? { error: llmError } : {}),
        timestamp: new Date().toISOString(),
      }) + "\n"
    );
  }

  if (llmError != null) {
    return NextResponse.json({ error: "LLM unavailable" }, { status: 502 });
  }

  if (!improved) {
    return NextResponse.json({ error: "Improvement failed" }, { status: 500 });
  }

  return NextResponse.json({ improved });
}
