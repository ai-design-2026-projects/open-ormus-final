# Settings Page — Design Spec

**Date:** 2026-06-01
**Branch:** worktree-feature-profile-settings

---

## Scope

A minimal `/settings` page with three independent actions:

1. Change email
2. Change password
3. Delete account

No profile fields, no display name, no LLM preferences, no theme — those require new DB work not in scope here.

---

## Route

`frontend/app/settings/page.tsx` — protected by the existing middleware (`proxy.ts`). No new layout file.

A "Settings" link is added to the header on `frontend/app/page.tsx` alongside the existing "Conversations" link and logout button.

---

## Page Structure

Single page, three sections stacked vertically in order:

1. **Email** — top
2. **Password** — middle
3. **Danger Zone** — bottom (visually distinct)

Each section has its own `<form>` that submits independently. Inline `<p>` for success/error feedback below each submit button. No toast library.

---

## Server Actions

File: `frontend/app/settings/actions.ts`

### `changeEmail(formData: FormData)`

- Reads `email` from form data.
- Calls `supabase.auth.updateUser({ email })` (server-side Supabase client).
- Returns `{ error?: string }`.
- On success: displays "Check your inbox to confirm the change." (Supabase sends a confirmation email to the new address; the change is not applied until confirmed.)

### `changePassword(formData: FormData)`

- Reads `password` and `confirm` from form data.
- Client-side validation: passwords must match before submit.
- Calls `supabase.auth.updateUser({ password })`.
- Returns `{ error?: string }`.
- On success: displays "Password updated."

### `deleteAccount()`

- Two-step confirmation: primary button reveals a second "Yes, delete my account" button; the action only fires on the second click.
- Server action deletes all user rows in dependency order:
  1. `ConversationJob` (by userId)
  2. `AgentTurn` (via AgentSession → userId)
  3. `AgentSession` (by userId)
  4. `Message` (via Conversation → userId)
  5. `ConversationParticipant` (via Conversation → userId)
  6. `Conversation` (by userId)
  7. `Character` (by userId)
  8. `User` (by userId)
- Then calls `supabase.auth.admin.deleteUser(userId)` using `SUPABASE_SERVICE_ROLE_KEY`.
- Redirects to `/login` on success.
- On error: displays inline error; does not redirect.

---

## Auth Pattern

All server actions follow the existing pattern:

```ts
const { data: { user }, error } = await supabase.auth.getUser();
if (!user) return { error: "Unauthorized" };
```

`userId` comes only from the validated Supabase user, never from form input.

---

## No DB Migration Required

All three actions work with the existing Prisma schema. No new models or fields.

---

## Files Touched

| File | Change |
|------|--------|
| `frontend/app/settings/page.tsx` | New — settings page |
| `frontend/app/settings/actions.ts` | New — three server actions |
| `frontend/app/page.tsx` | Add "Settings" link to header |
