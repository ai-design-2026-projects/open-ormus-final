# Character Conversations View — Design Spec

**Date:** 2026-05-21  
**Status:** Approved

## Goal

Show all conversations that include a given character inside the existing `CharacterViewDrawer` slide-in panel.

## Approach

Add a tab bar to `CharacterViewDrawer` with two tabs: **Sheet** (existing content) and **Conversations** (new). Conversations are fetched lazily on first tab activation from a new API route.

## Architecture

### New API route

`GET /api/characters/[id]/conversations`

- Auth: `supabase.auth.getUser()` — 401 if not authenticated
- Prisma query:
  ```ts
  prisma.conversation.findMany({
    where: {
      userId: user.id,
      participants: { some: { characterId: id } },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      participants: { include: { character: { select: { id: true, name: true } } }, orderBy: { turnOrder: "asc" } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { character: { select: { name: true } } } },
    },
  })
  ```
- Response shape: same as `GET /api/conversations` items — `{ id, title, createdAt, participants: [{characterId, name}], lastMessage: {characterName, content, createdAt} | null }[]`
- 404 if character doesn't belong to `user.id` (checked via participant query scoping)

### Component changes

**`CharacterViewDrawer.tsx`** (only file modified in `components/`):

- Add `activeTab: "sheet" | "conversations"` state, default `"sheet"`
- Add `conversations: ConversationItem[] | null` state and `convsLoading`, `convsError` states
- Add tab bar below sticky header (two pill/underline buttons)
- On tab switch to `"conversations"`: fetch once, cache result; subsequent switches use cached state
- Sheet tab: renders existing content unchanged
- Conversations tab:
  - Loading: spinner text
  - Error: inline message + retry button (re-fetches)
  - Empty: "No conversations yet"
  - List: each item shows title (Next.js `<Link>` → `/conversations/[id]`), co-participants (all participants except this character), last message snippet + relative timestamp

## Data Flow

```
User opens drawer → activeTab = "sheet" (no fetch)
User clicks "Conversations" tab → fetch /api/characters/[id]/conversations
  → success: render list
  → error: show error + retry
User clicks conversation title → navigate to /conversations/[id] (page nav closes drawer)
```

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| API 401 | Show "Unauthorized" inline |
| API 5xx / network | Show "Failed to load" + retry button |
| Empty result | Show "No conversations yet" |
| Character not found | 404 from API; inline error |

## Out of Scope

- Creating a new conversation from the drawer
- Separate character detail page
- Pagination (no character is expected to have hundreds of conversations in current usage)
