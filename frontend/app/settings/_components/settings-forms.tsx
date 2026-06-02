"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AppNav } from "@/components/app-shell/AppNav"
import { Button } from "@/components/ui/button"
import { changeEmail, changePassword, deleteAccount } from "../actions"
import type { SettingsActionState } from "../actions"

const initial: SettingsActionState = { error: null }

const inputClass =
  "flex h-9 w-full rounded-[var(--r-md)] border border-hair bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

export function SettingsForms({ email }: { email: string }) {
  const router = useRouter()
  const [emailState, emailAction, emailPending] = useActionState(changeEmail, initial)
  const [passwordState, passwordAction, passwordPending] = useActionState(changePassword, initial)
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAccount, initial)
  const [deleteInput, setDeleteInput] = useState("")

  useEffect(() => {
    if (emailState.success) router.refresh()
  }, [emailState.success, router])

  return (
    <div className="min-h-screen bg-background">
      <AppNav />

      <div className="max-w-[1440px] mx-auto px-14">
        {/* Page header */}
        <div className="py-8">
          <div className="t-meta">ACCOUNT</div>
          <h1 className="t-h2 mt-2 mb-0">Settings</h1>
        </div>

        {/* Form column */}
        <div className="max-w-[560px] flex flex-col gap-4 pb-14">

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
