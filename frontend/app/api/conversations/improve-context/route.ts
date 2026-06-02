import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createLLMClient } from "@/lib/llm-client";
import { createHash } from "crypto";
import { ImproveContextInputSchema } from "@open-ormus/shared";
import { logLlmUsage } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";

const SYSTEM_PROMPT = `You are a creative writing assistant specializing in fictional scene-setting.
Your task: improve a scene context description for a roleplay/story simulation.

Rules:
- If the input is sparse (fewer than 3 sentences or note-form): expand into a vivid, atmospheric paragraph
- If the input is a longer draft: polish prose, fix inconsistencies, improve narrative flow
- Preserve all factual details and character names from the original
- Do NOT suggest what characters should do, feel, or decide — only improve setting and prose
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

  const { draft, characterIds, userParticipates } = parsed.data;

  const characters = await prisma.character.findMany({
    where: { id: { in: characterIds }, userId: user.id },
    select: { name: true },
  });

  let userDisplayName: string | null = null;
  if (userParticipates) {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { displayName: true },
    });
    userDisplayName = dbUser?.displayName ?? "You";
  }

  const characterLines = [
    ...characters.map((ch) => `- ${ch.name}`),
    ...(userDisplayName ? [`- ${userDisplayName} (you)`] : []),
  ];

  const userMessage =
    characterLines.length > 0
      ? `Characters in this scene:\n${characterLines.join("\n")}\n\nScene context draft:\n${draft}`
      : `Scene context draft:\n${draft}`;

  const client = createLLMClient();
  const model = process.env["CONVERSATION_MODEL"];
  if (!model) {
    return NextResponse.json({ error: "CONVERSATION_MODEL env var not set" }, { status: 500 });
  }

  const start = Date.now();
  let improved = "";
  let llmError: string | null = null;
  let llmResponse: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null;
  let llmGenerationId = "";

  try {
    const { data, response: httpResponse } = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      temperature: 1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }).withResponse();
    llmResponse = data;
    llmGenerationId = httpResponse.headers.get("x-generation-id") ?? data.id;
    improved = (llmResponse.choices[0]?.message.content ?? "").trim();
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

  const cachedTokens = llmResponse!.usage?.prompt_tokens_details?.cached_tokens;
  const reasoningTokens = llmResponse!.usage?.completion_tokens_details?.reasoning_tokens;
  await logLlmUsage(
    { source: LlmUsageSource.IMPROVE_CONTEXT, userId: user.id },
    {
      generationId: llmGenerationId,
      model,
      inputTokens: llmResponse!.usage?.prompt_tokens ?? 0,
      outputTokens: llmResponse!.usage?.completion_tokens ?? 0,
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      latencyMs: Date.now() - start,
    },
  );

  if (!improved) {
    return NextResponse.json({ error: "Improvement failed" }, { status: 500 });
  }

  return NextResponse.json({ improved });
}
