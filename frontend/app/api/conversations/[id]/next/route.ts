import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
import { buildCharacterPrompt } from "@/lib/prompts";
import { CharacterSearchResultSchema } from "@open-ormus/shared";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
    include: {
      participants: {
        include: { character: true },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { character: { select: { name: true } } },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (conversation.participants.length === 0) {
    return NextResponse.json({ error: "No participants" }, { status: 400 });
  }

  const model = process.env["CONVERSATION_MODEL"];
  if (!model) {
    return NextResponse.json(
      { error: "CONVERSATION_MODEL env var not set" },
      { status: 500 },
    );
  }

  let nextParticipant: (typeof conversation.participants)[number];

  if (conversation.turnStrategy === 'ORCHESTRATOR') {
    const characterId = await selectNextSpeakerWithOrchestrator(
      conversation.participants,
      conversation.messages,
    );
    const found = conversation.participants.find(
      (p) => p.characterId === characterId,
    );
    if (!found) {
      console.error(
        `[next/route] orchestrator returned unknown characterId "${characterId}" — falling back to round-robin`,
      );
    }
    nextParticipant =
      found ??
      conversation.participants[
        conversation.messages.length % conversation.participants.length
      ]!;
  } else {
    nextParticipant =
      conversation.participants[
        conversation.messages.length % conversation.participants.length
      ]!;
  }

  const sheet = CharacterSearchResultSchema.parse(
    nextParticipant.character.sheet,
  );
  const systemPrompt = buildCharacterPrompt(sheet, conversation.context);

  const historyText =
    conversation.messages.length > 0
      ? conversation.messages
          .map((m) => `[${m.character.name}]: ${m.content}`)
          .join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const userMessage = `Conversation so far:\n${historyText}\n\nNow continue as ${nextParticipant.character.name}. Write only their next line.`;

  const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000";
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";

  const litellmResponse = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!litellmResponse.ok) {
    const text = await litellmResponse.text();
    return NextResponse.json(
      { error: `LiteLLM error: ${text}` },
      { status: 502 },
    );
  }

  const completion = (await litellmResponse.json()) as {
    content: { type: string; text: string }[];
  };

  const content = completion.content.find((b) => b.type === "text")?.text ?? "";

  const message = await prisma.message.create({
    data: {
      conversationId: id,
      characterId: nextParticipant.characterId,
      content,
    },
    include: { character: { select: { name: true } } },
  });

  return NextResponse.json(
    {
      id: message.id,
      conversationId: message.conversationId,
      characterId: message.characterId,
      characterName: message.character.name,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
