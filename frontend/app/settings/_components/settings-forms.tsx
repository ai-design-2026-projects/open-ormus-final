"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, X } from "lucide-react"
import { AppNav } from "@/components/app-shell/AppNav"
import { Monogram } from "@/components/ui/monogram"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { changeDisplayName, changeEmail, changePassword, deleteAccount } from "../actions"
import type { SettingsActionState } from "../actions"

const initial: SettingsActionState = { error: null }

const inputClass =
  "flex h-9 w-full rounded-[var(--r-md)] border border-hair bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

export function SettingsForms({ email, displayName }: { email: string; displayName: string }) {
  const router = useRouter()
  const [editingName, setEditingName] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [nameState, nameAction, namePending] = useActionState(changeDisplayName, initial)
  const [emailState, emailAction, emailPending] = useActionState(changeEmail, initial)
  const [passwordState, passwordAction, passwordPending] = useActionState(changePassword, initial)
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAccount, initial)
  const [deleteInput, setDeleteInput] = useState("")

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName])

  useEffect(() => {
    if (nameState.success) {
      setEditingName(false);
      window.dispatchEvent(new CustomEvent("user-name-updated"));
      router.refresh();
    }
  }, [nameState.success, router])

  useEffect(() => {
    if (emailState.success) router.refresh();
  }, [emailState.success, router])

  return (
    <div className="min-h-screen bg-background">
      <AppNav />

      <div className="max-w-[560px] mx-auto px-6 md:px-0">
        {/* Page header */}
        <div className="py-8 border-b border-hair">
          <div className="t-meta">ACCOUNT</div>
          <h1 className="t-h2 mt-2 mb-0">Settings</h1>
        </div>

        {/* Form column */}
        <div className="flex flex-col gap-4 py-8 pb-14">

          {/* Profile */}
          <section className="bg-surface-1 rounded-[var(--r-md)] border border-hair p-6 flex flex-col gap-4" style={{ boxShadow: "var(--shadow-1)" }}>
            <h2 className="t-meta">Profile</h2>
            <div className="flex items-center gap-4">
              <Monogram name={displayName || email || "User"} size={48} />
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <form action={nameAction} className="flex items-center gap-2">
                    <input
                      ref={nameInputRef}
                      id="displayName"
                      name="displayName"
                      type="text"
                      required
                      defaultValue={displayName}
                      autoComplete="name"
                      disabled={namePending}
                      className="h-9 flex-1 min-w-0 rounded-[var(--r-md)] border border-hair bg-transparent px-3 text-[17px] font-medium text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                    />
                    <Button type="submit" size="sm" disabled={namePending} className="shrink-0">
                      {namePending ? "Saving…" : "Save"}
                    </Button>
                    <IconButton type="button" variant="ghost" size="sm" aria-label="Cancel" onClick={() => setEditingName(false)}>
                      <X />
                    </IconButton>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="group flex items-center gap-2 text-left w-full rounded-[var(--r-sm)] -mx-1 px-1 py-0.5 hover:bg-bg-tinted transition-colors duration-[120ms]"
                    aria-label="Edit display name"
                  >
                    <span className="text-[22px] font-medium text-ink leading-tight truncate">
                      {displayName || <span className="text-ink-faint italic text-base">Add a name…</span>}
                    </span>
                    <Pencil className="size-3.5 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity shrink-0" strokeWidth={1.5} />
                  </button>
                )}
                <p className="t-mono text-xs text-ink-faint mt-1 truncate">{email}</p>
                {nameState.error && <p role="alert" className="text-xs text-signal-flag mt-1">{nameState.error}</p>}
              </div>
            </div>
          </section>

          {/* Email */}
          <section className="bg-surface-1 rounded-[var(--r-md)] border border-hair p-6 flex flex-col gap-4" style={{ boxShadow: "var(--shadow-1)" }}>
            <div>
              <h2 className="t-meta">Email</h2>
              <p className="t-mono text-xs text-ink-dim mt-1">{email}</p>
            </div>
            <form action={emailAction} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-xs font-medium text-ink-dim">New email address</label>
                <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
              </div>
              <Button type="submit" disabled={emailPending} className="self-start">
                {emailPending ? "Saving…" : "Update email"}
              </Button>
              {emailState.error && <p role="alert" className="text-xs text-signal-flag">{emailState.error}</p>}
              {emailState.success && <p role="alert" className="text-xs text-signal-ok">{emailState.success}</p>}
            </form>
          </section>

          {/* Password */}
          <section className="bg-surface-1 rounded-[var(--r-md)] border border-hair p-6 flex flex-col gap-4" style={{ boxShadow: "var(--shadow-1)" }}>
            <h2 className="t-meta">Password</h2>
            <form action={passwordAction} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="currentPassword" className="text-xs font-medium text-ink-dim">Current password</label>
                <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className={inputClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-xs font-medium text-ink-dim">New password</label>
                <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirmPassword" className="text-xs font-medium text-ink-dim">Confirm new password</label>
                <input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
              </div>
              <Button type="submit" disabled={passwordPending} className="self-start">
                {passwordPending ? "Saving…" : "Update password"}
              </Button>
              {passwordState.error && <p role="alert" className="text-xs text-signal-flag">{passwordState.error}</p>}
              {passwordState.success && <p role="alert" className="text-xs text-signal-ok">{passwordState.success}</p>}
            </form>
          </section>

          {/* Danger zone */}
          <section
            className="rounded-[var(--r-md)] border p-6 flex flex-col gap-4"
            style={{
              borderColor: "color-mix(in oklch, var(--signal-flag) 30%, transparent)",
              background: "color-mix(in oklch, var(--signal-flag) 4%, var(--bg))",
            }}
          >
            <div>
              <h2 className="t-meta" style={{ color: "var(--signal-flag)" }}>Danger zone</h2>
              <p className="text-xs text-ink-mute mt-1">Deleting your account is permanent and removes all your data.</p>
            </div>
            <form action={deleteAction} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="deleteConfirm" className="text-xs font-medium text-ink-dim">
                  Type <span className="t-mono font-semibold">DELETE</span> to confirm
                </label>
                <input
                  id="deleteConfirm"
                  type="text"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  autoComplete="off"
                  className={inputClass}
                />
              </div>
              <Button
                type="submit"
                variant="destructive"
                disabled={deleteInput !== "DELETE" || deletePending}
                className="self-start"
              >
                {deletePending ? "Deleting…" : "Delete account"}
              </Button>
              {deleteState.error && <p role="alert" className="text-xs text-signal-flag">{deleteState.error}</p>}
            </form>
          </section>

        </div>
      </div>
    </div>
  )
}
