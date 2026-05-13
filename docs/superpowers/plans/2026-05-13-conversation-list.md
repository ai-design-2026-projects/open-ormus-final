# Conversation List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated users create, browse, and continue multi-character simulated conversations, advancing one AI-generated turn at a time via a button click.

**Architecture:** Three Prisma models (Conversation, ConversationParticipant, Message) back five Next.js route handlers and two client-side pages. Round-robin speaker order is stateless — derived from `messages.length % participants.length`. LiteLLM is called via `fetch` using the Anthropic messages API format; no new SDK dependency is needed.

**Tech Stack:** Prisma 7 (PostgreSQL), Next.js 16 App Router, Zod v4, Tailwind CSS, LiteLLM proxy at `ANTHROPIC_BASE_URL`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | Modify | Add Conversation, ConversationParticipant, Message + Character reverse relations |
| `packages/shared/schema/conversation.ts` | Create | Zod input schemas + inferred record types |
| `packages/shared/schema/conversation.test.ts` | Create | Bun unit tests for schemas |
| `packages/shared/index.ts` | Modify | Re-export new conversation schemas |
| `frontend/app/api/characters/route.ts` | Create | GET user's characters (needed by create-conversation modal) |
| `frontend/app/api/conversations/route.ts` | Create | GET list + POST create |
| `frontend/app/api/conversations/[id]/route.ts` | Create | GET detail + DELETE |
| `frontend/app/api/conversations/[id]/next/route.ts` | Create | POST generate next turn via LiteLLM |
| `frontend/app/conversations/page.tsx` | Create | List page + inline create modal |
| `frontend/app/conversations/[id]/page.tsx` | Create | Chat view + generate-next button |
| `frontend/app/page.tsx` | Modify | Add link to /conversations |
| `.env.example` | Modify | Add ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, CONVERSATION_MODEL |

---

## Task 1: Prisma Schema — Add Conversation Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Update prisma/schema.prisma**

Replace the entire file content with the following (adds three models and two reverse relations on `Character`):

```prisma
generator client {
  provider = "prisma-client"
  output   = "../frontend/lib/generated/prisma"
}

generator client_mcp {
  provider = "prisma-client"
  output   = "../mcp_server/src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model User {
  id         String      @id @db.Uuid
  email      String      @unique
  createdAt  DateTime    @default(now()) @map("created_at")
  updatedAt  DateTime    @updatedAt @map("updated_at")
  characters Character[]
  conversations Conversation[]

  @@map("users")
}

model Character {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid @map("user_id")
  name      String
  sheet     Json
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user                     User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  conversationParticipants ConversationParticipant[]
  messages                 Message[]

  @@map("characters")
}

model Conversation {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid @map("user_id")
  title     String
  context   String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user         User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  participants ConversationParticipant[]
  messages     Message[]

  @@map("conversations")
}

model ConversationParticipant {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @db.Uuid @map("conversation_id")
  characterId    String   @db.Uuid @map("character_id")
  turnOrder      Int      @map("turn_order")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  character    Character    @relation(fields: [characterId], references: [id], onDelete: Cascade)

  @@unique([conversationId, turnOrder])
  @@map("conversation_participants")
}

model Message {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @db.Uuid @map("conversation_id")
  characterId    String   @db.Uuid @map("character_id")
  content        String
  createdAt      DateTime @default(now()) @map("created_at")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  character    Character    @relation(fields: [characterId], references: [id])

  @@map("messages")
}
```

- [ ] **Step 2: Run migration**

```bash
bun run --cwd frontend prisma migrate dev --name add_conversations
```

Expected: Migration created and applied. Output ends with `Your database is now in sync with your schema.`

- [ ] **Step 3: Regenerate Prisma client**

```bash
bun run --cwd frontend prisma generate
```

Expected: `Generated Prisma Client (7.8.0) to ./lib/generated/prisma`

- [ ] **Step 4: Verify type-check passes**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: No output (success).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add Conversation, ConversationParticipant, Message prisma models"
```

---

## Task 2: Shared Zod Schemas

**Files:**
- Create: `packages/shared/schema/conversation.ts`
- Create: `packages/shared/schema/conversation.test.ts`
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/schema/conversation.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  CreateConversationInputSchema,
  ConversationListItemSchema,
  ConversationRecordSchema,
  MessageRecordSchema,
} from "./conversation";

describe("CreateConversationInputSchema", () => {
  test("accepts valid input", () => {
    const result = CreateConversationInputSchema.safeParse({
      title: "Test scene",
      context: "A dark forest at midnight.",
      characterIds: [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty title", () => {
    const result = CreateConversationInputSchema.safeParse({
      title: "",
      context: "Some context",
      characterIds: ["11111111-1111-1111-1111-111111111111"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty characterIds array", () => {
    const result = CreateConversationInputSchema.safeParse({
      title: "Title",
      context: "Context",
      characterIds: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid UUID in characterIds", () => {
    const result = CreateConversationInputSchema.safeParse({
      title: "Title",
      context: "Context",
      characterIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });
});

describe("MessageRecordSchema", () => {
  test("accepts valid message record", () => {
    const result = MessageRecordSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      conversationId: "22222222-2222-2222-2222-222222222222",
      characterId: "33333333-3333-3333-3333-333333333333",
      characterName: "Alice",
      content: "Hello there.",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});

describe("ConversationListItemSchema", () => {
  test("accepts item with null lastMessage", () => {
    const result = ConversationListItemSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      title: "Scene 1",
      createdAt: new Date().toISOString(),
      participants: [
        { characterId: "22222222-2222-2222-2222-222222222222", name: "Alice" },
      ],
      lastMessage: null,
    });
    expect(result.success).toBe(true);
  });

  test("accepts item with lastMessage", () => {
    const result = ConversationListItemSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      title: "Scene 1",
      createdAt: new Date().toISOString(),
      participants: [
        { characterId: "22222222-2222-2222-2222-222222222222", name: "Alice" },
      ],
      lastMessage: {
        characterName: "Alice",
        content: "Hello.",
        createdAt: new Date().toISOString(),
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("ConversationRecordSchema", () => {
  test("accepts valid conversation record", () => {
    const result = ConversationRecordSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      title: "Scene 1",
      context: "Forest at night.",
      createdAt: new Date().toISOString(),
      participants: [
        {
          characterId: "22222222-2222-2222-2222-222222222222",
          name: "Alice",
          turnOrder: 0,
        },
      ],
      messages: [],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/shared/schema/conversation.test.ts
```

Expected: Error — `Cannot find module './conversation'`

- [ ] **Step 3: Create the schema file**

Create `packages/shared/schema/conversation.ts`:

```typescript
import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Invalid UUID"
  );

export const CreateConversationInputSchema = z.object({
  title: z.string().min(1),
  context: z.string().min(1),
  characterIds: z.array(uuidSchema).min(1),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;

export const MessageRecordSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  characterId: uuidSchema,
  characterName: z.string(),
  content: z.string(),
  createdAt: z.string(),
});
export type MessageRecord = z.infer<typeof MessageRecordSchema>;

export const ConversationListItemSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  createdAt: z.string(),
  participants: z.array(
    z.object({
      characterId: uuidSchema,
      name: z.string(),
    })
  ),
  lastMessage: z
    .object({
      characterName: z.string(),
      content: z.string(),
      createdAt: z.string(),
    })
    .nullable(),
});
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

export const ConversationRecordSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  context: z.string(),
  createdAt: z.string(),
  participants: z.array(
    z.object({
      characterId: uuidSchema,
      name: z.string(),
      turnOrder: z.number().int().min(0),
    })
  ),
  messages: z.array(MessageRecordSchema),
});
export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/shared/schema/conversation.test.ts
```

Expected:
```
 8 pass
 0 fail
```

- [ ] **Step 5: Export from packages/shared/index.ts**

Append these exports to the end of `packages/shared/index.ts`:

```typescript
export {
  CreateConversationInputSchema,
  type CreateConversationInput,
  MessageRecordSchema,
  type MessageRecord,
  ConversationListItemSchema,
  type ConversationListItem,
  ConversationRecordSchema,
  type ConversationRecord,
} from "./schema/conversation";
```

- [ ] **Step 6: Type-check shared**

```bash
bun run --cwd packages/shared tsc --noEmit
```

Expected: No output (success).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/schema/conversation.ts packages/shared/schema/conversation.test.ts packages/shared/index.ts
git commit -m "feat: add conversation Zod schemas to shared package"
```

---

## Task 3: GET /api/characters (Characters List for Modal)

**Files:**
- Create: `frontend/app/api/characters/route.ts`

This is a simple read-only endpoint needed by the conversation create modal to populate the participant checkbox list.

- [ ] **Step 1: Create the route file**

Create `frontend/app/api/characters/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const characters = await prisma.character.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(characters);
}
```

- [ ] **Step 2: Verify type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: No output (success).

- [ ] **Step 3: Manual smoke test**

Start the dev server (`bun run dev:frontend`) and in another terminal:

```bash
# Requires a valid session cookie — use the browser devtools to get it,
# or just verify the route returns 401 without auth:
curl -s http://localhost:3000/api/characters
# Expected: {"error":"Unauthorized"}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/api/characters/route.ts
git commit -m "feat: add GET /api/characters route for conversation modal"
```

---

## Task 4: GET + POST /api/conversations

**Files:**
- Create: `frontend/app/api/conversations/route.ts`

- [ ] **Step 1: Create the route file**

Create `frontend/app/api/conversations/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CreateConversationInputSchema } from "@open-ormus/shared";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      participants: {
        include: { character: { select: { id: true, name: true } } },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { character: { select: { name: true } } },
      },
    },
  });

  const items = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    participants: c.participants.map((p) => ({
      characterId: p.character.id,
      name: p.character.name,
    })),
    lastMessage:
      c.messages[0] != null
        ? {
            characterName: c.messages[0].character.name,
            content: c.messages[0].content,
            createdAt: c.messages[0].createdAt.toISOString(),
          }
        : null,
  }));

  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json();
  const parsed = CreateConversationInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { title, context, characterIds } = parsed.data;

  const characters = await prisma.character.findMany({
    where: { id: { in: characterIds }, userId: user.id },
    select: { id: true },
  });
  if (characters.length !== characterIds.length) {
    return NextResponse.json({ error: "Invalid character IDs" }, { status: 400 });
  }

  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      title,
      context,
      participants: {
        create: characterIds.map((characterId, index) => ({
          characterId,
          turnOrder: index,
        })),
      },
    },
    include: {
      participants: {
        include: { character: { select: { id: true, name: true } } },
        orderBy: { turnOrder: "asc" },
      },
    },
  });

  return NextResponse.json(
    {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      participants: conversation.participants.map((p) => ({
        characterId: p.character.id,
        name: p.character.name,
      })),
      lastMessage: null,
    },
    { status: 201 }
  );
}
```

- [ ] **Step 2: Verify type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/conversations/route.ts
git commit -m "feat: add GET + POST /api/conversations route handlers"
```

---

## Task 5: GET + DELETE /api/conversations/[id]

**Files:**
- Create: `frontend/app/api/conversations/[id]/route.ts`

- [ ] **Step 1: Create the route file**

Create `frontend/app/api/conversations/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
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
        include: { character: { select: { id: true, name: true } } },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { character: { select: { id: true, name: true } } },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    context: conversation.context,
    createdAt: conversation.createdAt.toISOString(),
    participants: conversation.participants.map((p) => ({
      characterId: p.character.id,
      name: p.character.name,
      turnOrder: p.turnOrder,
    })),
    messages: conversation.messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      characterId: m.characterId,
      characterName: m.character.name,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
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
    select: { id: true },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.conversation.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: Verify type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/api/conversations/[id]/route.ts"
git commit -m "feat: add GET + DELETE /api/conversations/[id] route handlers"
```

---

## Task 6: POST /api/conversations/[id]/next + Env Vars

**Files:**
- Create: `frontend/app/api/conversations/[id]/next/route.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example**

Add these three variables to `.env.example` (after the existing entries):

```dotenv
# LiteLLM proxy (Anthropic-compatible API)
ANTHROPIC_BASE_URL="http://localhost:4000"
ANTHROPIC_API_KEY="your_litellm_master_key"

# Model name passed to LiteLLM for conversation generation
# Must match a model alias configured in your LiteLLM config
CONVERSATION_MODEL="claude-3-5-haiku-20241022"
```

Also add the same three keys to your local `.env.local` with real values before testing.

- [ ] **Step 2: Create the route file**

Create `frontend/app/api/conversations/[id]/next/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

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
      { status: 500 }
    );
  }

  const nextParticipant =
    conversation.participants[
      conversation.messages.length % conversation.participants.length
    ];

  if (nextParticipant === undefined) {
    return NextResponse.json({ error: "Could not determine next speaker" }, { status: 500 });
  }

  const systemPrompt = [
    `You are ${nextParticipant.character.name}.`,
    `Your character sheet: ${JSON.stringify(nextParticipant.character.sheet)}`,
    `Scene context: ${conversation.context}`,
    `Respond only as ${nextParticipant.character.name}. Write only the character's next line of dialogue or action. Do not include a name prefix.`,
  ].join("\n\n");

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
      { status: 502 }
    );
  }

  const completion = (await litellmResponse.json()) as {
    content: { type: string; text: string }[];
  };

  const content =
    completion.content.find((b) => b.type === "text")?.text ?? "";

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
    { status: 201 }
  );
}
```

- [ ] **Step 3: Verify type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: No output (success).

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/api/conversations/[id]/next/route.ts" .env.example
git commit -m "feat: add POST /api/conversations/[id]/next — LiteLLM round-robin generation"
```

---

## Task 7: /conversations List Page + Create Modal

**Files:**
- Create: `frontend/app/conversations/page.tsx`

- [ ] **Step 1: Create the page**

Create `frontend/app/conversations/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Participant = { characterId: string; name: string };
type LastMessage = {
  characterName: string;
  content: string;
  createdAt: string;
} | null;
type ConversationItem = {
  id: string;
  title: string;
  createdAt: string;
  participants: Participant[];
  lastMessage: LastMessage;
};
type Character = { id: string; name: string };

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function loadConversations() {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations((await res.json()) as ConversationItem[]);
    setLoading(false);
  }

  async function loadCharacters() {
    const res = await fetch("/api/characters");
    if (res.ok) setCharacters((await res.json()) as Character[]);
  }

  useEffect(() => {
    void loadConversations();
    void loadCharacters();
  }, []);

  function toggleCharacter(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function openModal() {
    setTitle("");
    setContext("");
    setSelectedIds([]);
    setCreateError(null);
    setShowModal(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    // Preserve alphabetical display order for turnOrder, not click order
    const orderedIds = characters
      .filter((ch) => selectedIds.includes(ch.id))
      .map((ch) => ch.id);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, context, characterIds: orderedIds }),
    });
    setCreating(false);
    if (res.ok) {
      setShowModal(false);
      void loadConversations();
    } else {
      setCreateError("Failed to create conversation.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    void loadConversations();
  }

  if (loading) return <p className="p-8 text-zinc-500">Loading...</p>;

  return (
    <div className="max-w-3xl mx-auto p-8 font-sans">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Conversations</h1>
        <button
          onClick={openModal}
          className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-zinc-800"
        >
          New conversation
        </button>
      </div>

      {conversations.length === 0 ? (
        <p className="text-zinc-400 italic">No conversations yet. Start one.</p>
      ) : (
        <ul className="divide-y divide-zinc-200">
          {conversations.map((c) => (
            <li key={c.id} className="py-4 flex items-start justify-between gap-4">
              <Link href={`/conversations/${c.id}`} className="flex-1 min-w-0">
                <p className="font-medium hover:underline">{c.title}</p>
                {c.lastMessage != null ? (
                  <p className="text-sm text-zinc-500 truncate">
                    {c.lastMessage.characterName}: {c.lastMessage.content}
                  </p>
                ) : (
                  <p className="text-sm text-zinc-400 italic">No messages yet</p>
                )}
                <p className="text-xs text-zinc-400 mt-1">
                  {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </Link>
              <button
                onClick={() => void handleDelete(c.id)}
                className="text-sm text-red-500 hover:text-red-700 shrink-0"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">New conversation</h2>
            <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full border border-zinc-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Scene context</label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  required
                  rows={3}
                  className="w-full border border-zinc-300 rounded px-3 py-2 text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Participants{" "}
                  <span className="text-zinc-400 font-normal">(select at least one)</span>
                </label>
                {characters.length === 0 ? (
                  <p className="text-sm text-zinc-400 italic">
                    No characters found. Create characters first.
                  </p>
                ) : (
                  <ul className="border border-zinc-200 rounded divide-y max-h-40 overflow-y-auto">
                    {characters.map((ch) => (
                      <li key={ch.id} className="flex items-center gap-2 px-3 py-2">
                        <input
                          type="checkbox"
                          id={`char-${ch.id}`}
                          checked={selectedIds.includes(ch.id)}
                          onChange={() => toggleCharacter(ch.id)}
                        />
                        <label htmlFor={`char-${ch.id}`} className="text-sm cursor-pointer">
                          {ch.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {createError != null && (
                <p className="text-sm text-red-500">{createError}</p>
              )}
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || selectedIds.length === 0}
                  className="px-4 py-2 text-sm bg-black text-white rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/conversations/page.tsx
git commit -m "feat: add /conversations list page with create modal"
```

---

## Task 8: /conversations/[id] Chat View Page

**Files:**
- Create: `frontend/app/conversations/[id]/page.tsx`

- [ ] **Step 1: Create the page**

Create `frontend/app/conversations/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Participant = { characterId: string; name: string; turnOrder: number };
type Message = {
  id: string;
  characterName: string;
  content: string;
  createdAt: string;
};
type ConversationDetail = {
  id: string;
  title: string;
  context: string;
  participants: Participant[];
  messages: Message[];
};

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) setConversation((await res.json()) as ConversationDetail);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function handleGenerateNext() {
    if (conversation === null) return;
    setGenerating(true);
    setGenerateError(null);
    const res = await fetch(`/api/conversations/${id}/next`, { method: "POST" });
    setGenerating(false);
    if (res.ok) {
      const newMessage = (await res.json()) as Message;
      setConversation((prev) =>
        prev !== null ? { ...prev, messages: [...prev.messages, newMessage] } : prev
      );
    } else {
      setGenerateError("Failed to generate next message. Check that LiteLLM is running.");
    }
  }

  if (loading) return <p className="p-8 text-zinc-500">Loading...</p>;
  if (conversation === null) return <p className="p-8 text-zinc-500">Conversation not found.</p>;

  const sortedParticipants = [...conversation.participants].sort(
    (a, b) => a.turnOrder - b.turnOrder
  );
  const nextSpeaker =
    sortedParticipants[conversation.messages.length % sortedParticipants.length];

  return (
    <div className="max-w-3xl mx-auto p-8 font-sans">
      <Link
        href="/conversations"
        className="text-sm text-zinc-500 hover:text-black mb-4 block"
      >
        ← Back to conversations
      </Link>

      <h1 className="text-2xl font-semibold mb-1">{conversation.title}</h1>
      <p className="text-sm text-zinc-500 mb-6">
        {sortedParticipants.map((p) => p.name).join(", ")}
      </p>

      <div className="flex flex-col gap-3 mb-8 min-h-[4rem]">
        {conversation.messages.length === 0 ? (
          <p className="text-zinc-400 italic">No messages yet. Generate the first one.</p>
        ) : (
          conversation.messages.map((m) => (
            <div key={m.id} className="text-sm">
              <span className="font-medium">{m.characterName}:</span>{" "}
              <span className="text-zinc-700">{m.content}</span>
              <span className="text-xs text-zinc-400 ml-2">
                {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>

      {nextSpeaker !== undefined && (
        <p className="text-xs text-zinc-400 mb-2">Next: {nextSpeaker.name}</p>
      )}

      {generateError !== null && (
        <p className="text-sm text-red-500 mb-2">{generateError}</p>
      )}

      <button
        onClick={() => void handleGenerateNext()}
        disabled={generating}
        className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-zinc-800 disabled:opacity-50"
      >
        {generating ? "Generating..." : "Generate next"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/conversations/[id]/page.tsx"
git commit -m "feat: add /conversations/[id] chat view page"
```

---

## Task 9: Home Page Link + Final Type-Check

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Add link to /conversations in the home page**

In `frontend/app/page.tsx`, find the `<div className="flex flex-col gap-4 ...">` block that contains the deploy/docs links and add a Conversations link before them:

Replace the button block starting at line 62:

```tsx
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
```

with:

```tsx
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          <Link
            href="/conversations"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[180px]"
          >
            Conversations
          </Link>
```

Also add the `Link` import at the top of the file (Next.js `Link` is already available via `next/link`):

```tsx
import Link from "next/link";
```

- [ ] **Step 2: Final type-check — all workspaces**

```bash
bun run --cwd frontend tsc --noEmit && bun run --cwd packages/shared tsc --noEmit
```

Expected: No output from either command (both succeed).

- [ ] **Step 3: Run shared tests one last time**

```bash
bun test packages/shared
```

Expected: All pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: add conversations link to home page"
```

---

## End-to-End Manual Test Checklist

With `bun run dev:frontend` running and a real DB + LiteLLM proxy configured:

- [ ] Log in → home page shows "Conversations" link
- [ ] Click link → `/conversations` loads (empty state: "No conversations yet")
- [ ] Click "New conversation" → modal opens
- [ ] Select 2 characters, fill title and context → click "Create" → modal closes, conversation appears in list
- [ ] Click the conversation → `/conversations/[id]` loads with empty message list
- [ ] Click "Generate next" → a message appears attributed to the first character
- [ ] Click "Generate next" again → second message appears attributed to the second character
- [ ] Go back to list → last message column shows correctly
- [ ] Delete the conversation → it disappears from the list
- [ ] Unauthenticated requests to `/api/conversations` return `401`
