"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { resetPassword, type AuthActionState } from "@/app/(auth)/actions"

const initialState: AuthActionState = { error: null }

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Updating…" : "Set new password"}
    </Button>
  )
}

export default function ResetPasswordPage() {
  const [state, formAction] = useActionState(resetPassword, initialState)

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        <div className="flex flex-col gap-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Set new password
          </h1>
          <form action={formAction} className="flex flex-col gap-4">
            <input
              name="password"
              type="password"
              placeholder="New password"
              required
              autoComplete="new-password"
              className={inputClass}
            />
            <input
              name="confirmPassword"
              type="password"
              placeholder="Confirm new password"
              required
              autoComplete="new-password"
              className={inputClass}
            />
            {state.error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}
            <SubmitButton />
          </form>
        </div>
      </div>
    </div>
  )
}
