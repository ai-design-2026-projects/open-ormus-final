# Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/settings` page with three independent actions: change email, change password, delete account.

**Architecture:** One new route (`app/settings/`) with a client-component page and a server-actions file. The header on the home page gains a Settings link. No DB migration — all three actions use the existing Prisma schema and Supabase auth APIs.

**Tech Stack:** Next.js 16 App Router, React 19 `useActionState`, Supabase SSR (`@supabase/ssr`), Supabase admin SDK (`@supabase/supabase-js`), Prisma 7, Zod 4, Tailwind CSS.

> **Note:** The frontend has no test framework. Verification gates are `bun run typecheck` and `bun run build` run from the repo root. Run both after every task.

---

## File Map

| Action | Path |
|--------|------|
| Create | `frontend/app/settings/actions.ts` |
| Create | `frontend/app/settings/page.tsx` |
| Modify | `frontend/app/page.tsx` (header only) |

---

## Task 1: Server actions

**Files:**
- Create: `frontend/app/settings/actions.ts`

- [ ] **Step 1: Create `frontend/app/settings/actions.ts`**

```typescript
"use server"

import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { z } from "zod"

export type SettingsActionState = { error: string | null; success?: string }

const emailSchema = z.object({ email: z.string().email() })
const passwordSchema = z.object({ password: z.string().min(8) })

export async function changeEmail(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  const { error } = await supabase.auth.updateUser({ email: parsed.data.email })
  if (error) return { error: error.message }

  return { error: null, success: "Check your inbox to confirm the change." }
}

export async function changePassword(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = passwordSchema.safeParse({ password: formData.get("password") })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  return { error: null, success: "Password updated." }
}

export async function deleteAccount(
  _prev: SettingsActionState,
  _formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  const userId = user.id

  const sessions = await prisma.agentSession.findMany({
    where: { userId },
    select: { id: true },
  })
  const sessionIds = sessions.map((s) => s.id)

  const conversations = await prisma.conversation.findMany({
    where: { userId },
    select: { id: true },
  })
  const convIds = conversations.map((c) => c.id)

  await prisma.conversationJob.deleteMany({ where: { userId } })
  await prisma.agentTurn.deleteMany({ where: { sessionId: { in: sessionIds } } })
  await prisma.agentSession.deleteMany({ where: { userId } })
  await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } })
  await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: convIds } } })
  await prisma.conversation.deleteMany({ where: { userId } })
  await prisma.character.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return { error: error.message }

  redirect("/login")
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors in `frontend/app/settings/actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/settings/actions.ts
git commit -m "feat: add settings server actions (email, password, delete account)"
```

---

## Task 2: Settings page

**Files:**
- Create: `frontend/app/settings/page.tsx`

- [ ] **Step 1: Create `frontend/app/settings/page.tsx`**

```typescript
"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { logout } from "@/app/(auth)/actions"
import { changeEmail, changePassword, deleteAccount } from "./actions"
import type { SettingsActionState } from "./actions"

const initial: SettingsActionState = { error: null }

export default function SettingsPage() {
  const [emailState, emailAction, emailPending] = useActionState(changeEmail, initial)
  const [passwordState, passwordAction, passwordPending] = useActionState(changePassword, initial)
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAccount, initial)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-10 bg-white border-b border-zinc-200 px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">OpenOrmus</h1>
        <nav className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-800 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
          >
            Characters
          </Link>
          <Link
            href="/conversations"
            className="text-sm text-zinc-500 hover:text-zinc-800 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
          >
            Conversations
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="text-sm text-zinc-500 hover:text-zinc-800 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
            >
              Log out
            </button>
          </form>
        </nav>
      </header>

      <main className="max-w-xl mx-auto px-6 py-8 flex flex-col gap-8">
        <section>
          <h2 className="text-sm font-medium text-zinc-900 mb-3">Email</h2>
          <form action={emailAction} className="flex flex-col gap-3">
            <input
              name="email"
              type="email"
              placeholder="New email address"
              required
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <button
              type="submit"
              disabled={emailPending}
              className="self-start px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              {emailPending ? "Saving…" : "Update email"}
            </button>
            {emailState.error && (
              <p className="text-sm text-red-600">{emailState.error}</p>
            )}
            {emailState.success && (
              <p className="text-sm text-green-700">{emailState.success}</p>
            )}
          </form>
        </section>

        <section>
          <h2 className="text-sm font-medium text-zinc-900 mb-3">Password</h2>
          <form action={passwordAction} className="flex flex-col gap-3">
            <input
              name="password"
              type="password"
              placeholder="New password (min 8 characters)"
              required
              minLength={8}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <button
              type="submit"
              disabled={passwordPending}
              className="self-start px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              {passwordPending ? "Saving…" : "Update password"}
            </button>
            {passwordState.error && (
              <p className="text-sm text-red-600">{passwordState.error}</p>
            )}
            {passwordState.success && (
              <p className="text-sm text-green-700">{passwordState.success}</p>
            )}
          </form>
        </section>

        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-medium text-red-900 mb-1">Danger zone</h2>
          <p className="text-xs text-red-700 mb-4">
            Deleting your account is permanent and removes all your data.
          </p>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Delete account
            </button>
          ) : (
            <form action={deleteAction} className="flex flex-col gap-3">
              <p className="text-sm font-medium text-red-800">
                Are you sure? This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={deletePending}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {deletePending ? "Deleting…" : "Yes, delete my account"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-4 py-2 text-sm bg-white text-zinc-700 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
              {deleteState.error && (
                <p className="text-sm text-red-600">{deleteState.error}</p>
              )}
            </form>
          )}
        </section>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors in `frontend/app/settings/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/settings/page.tsx
git commit -m "feat: add settings page UI"
```

---

## Task 3: Add Settings link to home header

**Files:**
- Modify: `frontend/app/page.tsx` lines 111–127 (header `<nav>`)

- [ ] **Step 1: Add Settings link in `frontend/app/page.tsx`**

Find this block in the `<nav>` (around line 112):

```tsx
<nav className="flex items-center gap-4">
  <Link
    href="/conversations"
    className="text-sm text-zinc-500 hover:text-zinc-800 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
  >
    Conversations
  </Link>
  <form action={logout}>
```

Replace with:

```tsx
<nav className="flex items-center gap-4">
  <Link
    href="/conversations"
    className="text-sm text-zinc-500 hover:text-zinc-800 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
  >
    Conversations
  </Link>
  <Link
    href="/settings"
    className="text-sm text-zinc-500 hover:text-zinc-800 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
  >
    Settings
  </Link>
  <form action={logout}>
```

- [ ] **Step 2: Run typecheck then build**

```bash
bun run typecheck && bun run build
```

Expected: typecheck clean, build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: add Settings link to home header"
```
