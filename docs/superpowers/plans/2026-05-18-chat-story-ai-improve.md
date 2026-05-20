# Scene Context AI Improvement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "✨ Improve" button to the scene context textarea in the conversation creation modal that sends the draft + selected character IDs to a new API endpoint, calls the LLM, and shows a side-by-side Accept/Discard modal with the result.

**Architecture:** New Zod schema in `packages/shared` → stateless POST route at `/api/conversations/improve-context` (auth + Prisma character fetch + single LLM call) → two new React components (`ImproveContextModal`, improve button inline) → wired into `frontend/app/conversations/page.tsx`.

**Tech Stack:** Next.js App Router route handler, Anthropic SDK (`@anthropic-ai/sdk`), Prisma, Zod (v4 via `@open-ormus/shared`), `bun:test` for schema tests, Tailwind CSS for UI.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `packages/shared/schema/conversation.ts` | Add `ImproveContextInputSchema` |
| Modify | `packages/shared/index.ts` | Export new schema + type |
| Create | `packages/shared/schema/conversation.test.ts` | Schema validation tests |
| Create | `frontend/app/api/conversations/improve-context/route.ts` | Auth → Prisma → LLM → JSON response |
| Create | `frontend/components/conversations/ImproveContextModal.tsx` | Side-by-side Accept/Discard modal |
| Modify | `frontend/app/conversations/page.tsx` | Wire button + modal into create form |

---

## Task 1: Add `ImproveContextInput` schema to shared package

**Files:**
- Modify: `packages/shared/schema/conversation.ts`
- Modify: `packages/shared/index.ts`
- Create: `packages/shared/schema/conversation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/schema/conversation.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { ImproveContextInputSchema } from "./conversation";

describe("ImproveContextInputSchema", () => {
  test("accepts valid input", () => {
    const result = ImproveContextInputSchema.safeParse({
      draft: "Walter and Jesse meet in the desert at sunset",
      characterIds: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty draft", () => {
    const result = ImproveContextInputSchema.safeParse({
      draft: "",
      characterIds: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty characterIds array", () => {
    const result = ImproveContextInputSchema.safeParse({
      draft: "A scene in the desert",
      characterIds: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects malformed UUID in characterIds", () => {
    const result = ImproveContextInputSchema.safeParse({
      draft: "A scene",
      characterIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test --cwd packages/shared schema/conversation.test.ts
```

Expected: error — `ImproveContextInputSchema` not found.

- [ ] **Step 3: Add schema to `packages/shared/schema/conversation.ts`**

Append to the end of the existing file (after `ConversationRecord`). The `uuidSchema` is already defined at the top of the file — reuse it:

```ts
export const ImproveContextInputSchema = z.object({
  draft: z.string().min(1),
  characterIds: z.array(uuidSchema).min(1),
});
export type ImproveContextInput = z.infer<typeof ImproveContextInputSchema>;
```

- [ ] **Step 4: Export from `packages/shared/index.ts`**

Add two lines to the existing `conversation` export block (around line 48):

```ts
export {
  CreateConversationInputSchema,
  type CreateConversationInput,
  ImproveContextInputSchema,        // ← add
  type ImproveContextInput,         // ← add
  MessageRecordSchema,
  // ... rest unchanged
} from "./schema/conversation";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test --cwd packages/shared schema/conversation.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/schema/conversation.ts packages/shared/index.ts packages/shared/schema/conversation.test.ts
git commit -m "feat: add ImproveContextInputSchema to shared package"
```

---

## Task 2: Implement `/api/conversations/improve-context` route

**Files:**
- Create: `frontend/app/api/conversations/improve-context/route.ts`

No unit test infrastructure exists for Next.js route handlers in this project. Correctness is verified via `bun run typecheck`.

- [ ] **Step 1: Create the route file**

Create `frontend/app/api/conversations/improve-context/route.ts`:

```ts
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

  const body: unknown = await request.json();
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
  const model = process.env["CONVERSATION_MODEL"] ?? "default";

  const start = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  const latency_ms = Date.now() - start;

  const textBlock = response.content.find((b) => b.type === "text");
  const improved = textBlock?.type === "text" ? textBlock.text.trim() : "";

  process.stderr.write(
    JSON.stringify({
      component: "improve-context",
      userId: user.id,
      model,
      prompt_hash: createHash("sha256").update(draft).digest("hex").slice(0, 8),
      latency_ms,
      timestamp: new Date().toISOString(),
    }) + "\n"
  );

  if (!improved) {
    return NextResponse.json({ error: "Improvement failed" }, { status: 500 });
  }

  return NextResponse.json({ improved });
}
```

- [ ] **Step 2: Run typecheck to verify no errors introduced**

```bash
bun run typecheck 2>&1 | grep "improve-context"
```

Expected: no output (no errors in the new file). Pre-existing errors on other files are acceptable.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/conversations/improve-context/route.ts
git commit -m "feat: add improve-context API route"
```

---

## Task 3: Build `ImproveContextModal` component

**Files:**
- Create: `frontend/components/conversations/ImproveContextModal.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/conversations/ImproveContextModal.tsx`:

```tsx
"use client";

type Props = {
  original: string;
  improved: string;
  onAccept: (text: string) => void;
  onDiscard: () => void;
};

export function ImproveContextModal({ original, improved, onAccept, onDiscard }: Props) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl shadow-xl mx-4">
        <h2 className="text-lg font-semibold mb-4">Improved scene context</h2>
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="flex-1">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
              Original
            </p>
            <div className="border border-zinc-200 rounded p-3 text-sm text-zinc-600 bg-zinc-50 min-h-[100px] whitespace-pre-wrap">
              {original}
            </div>
          </div>
          <div className="flex-1">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
              Improved
            </p>
            <div className="border border-zinc-200 rounded p-3 text-sm text-zinc-800 bg-white min-h-[100px] whitespace-pre-wrap">
              {improved}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="px-4 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => onAccept(improved)}
            className="px-4 py-2 text-sm bg-black text-white rounded hover:bg-zinc-800"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck 2>&1 | grep "ImproveContextModal"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/conversations/ImproveContextModal.tsx
git commit -m "feat: add ImproveContextModal component"
```

---

## Task 4: Wire button and modal into `conversations/page.tsx`

**Files:**
- Modify: `frontend/app/conversations/page.tsx`

The page currently has no `improving` state or improve handler. Changes are surgical — only the scene context `<div>` block and the modal rendering at the bottom of the outer modal are touched.

- [ ] **Step 1: Add import at the top of the file**

After the existing `import Link from "next/link";` line, add:

```ts
import { ImproveContextModal } from "@/components/conversations/ImproveContextModal";
```

- [ ] **Step 2: Add state variables**

Inside `ConversationsPage`, after the existing `const [createError, setCreateError] = useState<string | null>(null);` line, add:

```ts
const [improving, setImproving] = useState(false);
const [improveResult, setImproveResult] = useState<{
  original: string;
  improved: string;
} | null>(null);
```

- [ ] **Step 3: Add `handleImprove` function**

After the existing `handleDelete` function, add:

```ts
async function handleImprove() {
  setImproving(true);
  setCreateError(null);
  const draftAtClick = context;
  try {
    const res = await fetch("/api/conversations/improve-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: draftAtClick, characterIds: selectedIds }),
    });
    if (!res.ok) {
      setCreateError("Improvement failed — try again.");
      return;
    }
    const data = (await res.json()) as { improved: string };
    setImproveResult({ original: draftAtClick, improved: data.improved });
  } catch {
    setCreateError("Improvement failed — try again.");
  } finally {
    setImproving(false);
  }
}
```

- [ ] **Step 4: Replace the scene context `<div>` block**

Replace the existing block (lines 156–165 in the original file):

```tsx
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
```

With:

```tsx
<div>
  <div className="flex items-center justify-between mb-1">
    <label className="block text-sm font-medium">Scene context</label>
    <button
      type="button"
      onClick={() => void handleImprove()}
      disabled={!context.trim() || selectedIds.length === 0 || improving}
      className="text-xs px-2 py-1 border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-40"
    >
      {improving ? "Improving..." : "✨ Improve"}
    </button>
  </div>
  <textarea
    value={context}
    onChange={(e) => setContext(e.target.value)}
    required
    rows={3}
    className="w-full border border-zinc-300 rounded px-3 py-2 text-sm resize-none"
  />
</div>
```

- [ ] **Step 5: Add modal rendering**

Inside the `{showModal && (...)}` block, after the closing `</form>` tag and before the closing `</div>` of the modal panel, add:

```tsx
{improveResult != null && (
  <ImproveContextModal
    original={improveResult.original}
    improved={improveResult.improved}
    onAccept={(text) => {
      setContext(text);
      setImproveResult(null);
    }}
    onDiscard={() => setImproveResult(null)}
  />
)}
```

The full modal JSX order becomes:
```
<div className="fixed inset-0 bg-black/40 ...">        ← create modal backdrop
  <div className="bg-white ...">                         ← create modal panel
    <h2>New conversation</h2>
    <form>...</form>
    {improveResult != null && <ImproveContextModal ... />}  ← improve modal (z-[60] overlays)
  </div>
</div>
```

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck 2>&1 | grep "conversations/page"
```

Expected: no new errors on `conversations/page.tsx`.

- [ ] **Step 7: Manual smoke test**

Start the frontend dev server:

```bash
bun run dev:frontend
```

Open `http://localhost:3000/conversations`. Click "New conversation". With no characters selected, confirm the "✨ Improve" button is disabled. Select at least one character and type a draft, then click "Improve". Verify:
1. Button shows "Improving..." while loading
2. Modal opens with "Original" and "Improved" panels side by side
3. "Accept" replaces the textarea text and closes the modal
4. "Discard" closes the modal without changing the textarea

- [ ] **Step 8: Commit**

```bash
git add frontend/app/conversations/page.tsx
git commit -m "feat: wire scene context improve button and modal into conversations page"
```

---

## Verification

After all tasks complete, run the full suite:

```bash
bun run typecheck
bun test --cwd mcp_server
bun test --cwd packages/shared schema/conversation.test.ts
```

Expected: 0 new type errors; 3 pre-existing mcp_server failures remain (not introduced by this work); conversation schema tests all pass.
