# PDF Upload in Chat — Design Spec

**Date:** 2026-06-03  
**Branch:** worktree-agent-file-upload  
**Status:** Approved

---

## Problem

Users cannot attach documents to chat messages. The app only accepts plain text. Adding PDF support requires threading file content through the existing agent pipeline in a format that OpenRouter can pass natively to capable models (GPT-4o, Claude, Gemini).

---

## Approach

Client-side base64 encoding. Browser reads the PDF via `FileReader.readAsDataURL()` — no server-side file I/O, no storage, no new routes. The base64 data URL is sent alongside the text message in the existing JSON POST body. The route handler passes it to `runAgent`, which builds an OpenAI content array containing a `{ type: "file" }` part. The `@openai/agents` SDK serializes the array as-is; OpenRouter receives the native file content part and routes it to the model.

---

## Data Flow

```
User picks PDF
  → FileReader.readAsDataURL()            (browser)
  → pendingAttachment: { filename, fileData: "data:application/pdf;base64,..." }

User sends message
  → POST /api/chat/stream
      { message, sessionId?, attachments: [{ filename, fileData }] }

Route handler
  → validates: max 1 attachment, fileData must start with "data:application/pdf;base64,"
  → passes attachments to runAgent()

runAgent()
  → AgentInputItem:
      {
        role: "user",
        content: [
          { type: "text", text: message },
          { type: "file", file: { filename, file_data: fileData } }
        ]
      }
  → @openai/agents SDK serializes → OpenRouter receives native file content part

OpenRouter
  → native model (GPT-4o / Claude / Gemini): passes PDF directly
  → non-native model: falls back to cloudflare-ai parser automatically (free)

History
  → AgentTurn.item stores AgentInputItem as JSONB — content array persists as-is
  → rowsToItems() replays correctly on session reload
  → extractText() skips file parts (no .text field) — safe, no change needed
```

---

## Changed Files

| File | Change |
|---|---|
| `frontend/app/chat/_components/chat-input.tsx` | Hidden `<input type="file" accept="application/pdf">`, paperclip button, attachment badge with remove, clear attachment on send. Callback: `onSend(message, attachment?)` |
| `frontend/app/chat/_components/chat-view.tsx` | Thread `attachment` through `handleSend`. Include in POST body. Add `{ type: "attachment", filename }` block to user message for display. |
| `frontend/app/chat/_components/message-thread.tsx` | Render `attachment` block as filename badge in user messages |
| `frontend/app/api/chat/stream/route.ts` | Extend `RequestSchema`: `attachments: z.array(AttachmentSchema).max(1).optional()`. Pass to `runAgent`. |
| `frontend/lib/agent/loop.ts` | Accept `attachments?: Attachment[]`. When present, build content array `AgentInputItem`; otherwise plain string (existing behaviour). |

**Not changed:** `packages/shared`, `mcp_server`, `prisma/schema.prisma`, no new dependencies.

---

## Constraints

- Max 1 PDF per message
- Max size: 20 MB (enforced client-side with a warning)
- MIME validation: `accept="application/pdf"` on input + server-side prefix check on `fileData`

---

## Error Handling

| Condition | Handling |
|---|---|
| File > 20 MB | Client-side warning, attachment not attached |
| Non-PDF selected | File input filter + server rejects non-`data:application/pdf;base64,` prefix |
| SDK strips `file` content type | Fallback: override in `LoggingModel.getStreamedResponse` to inject via `extra_body` — add only if confirmed broken after testing |
| Model lacks native PDF support | OpenRouter auto-falls back to `cloudflare-ai` engine (free) |
| PDF in reloaded session | Stored in `AgentTurn.item` JSONB — replays correctly |

---

## Testing

- Manual: upload PDF → inspect network tab → verify `messages[n].content` array contains `{ type: "file", file: { filename, file_data } }`
- No unit tests for `FileReader` path (browser API, UI state only)
- `bun run typecheck` must pass
- `bun test --cwd mcp_server` must remain green (no mcp_server changes)

---

## Out of Scope

- Multiple PDFs per message
- Image uploads
- Supabase Storage persistence of uploaded files
- OpenRouter `plugins` parameter (only needed if targeting non-vision models explicitly; auto-fallback covers the common case)
- OpenAI Files API (`/v1/files`) — not supported by OpenRouter
