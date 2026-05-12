"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { register, type AuthActionState } from "../actions"
import Link from "next/link"

const initialState: AuthActionState = { error: null }

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating account…" : "Create account"}
    </Button>
  )
}

export default function RegisterPage() {
  const [state, formAction] = useActionState(register, initialState)

  if (state.sent === true) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to your email. Click it to activate your
          account.
        </p>
        <Link href="/login" className="text-sm text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <form action={formAction} className="flex flex-col gap-4">
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          autoComplete="email"
          className={inputClass}
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          autoComplete="new-password"
          className={inputClass}
        />
        <input
          name="confirmPassword"
          type="password"
          placeholder="Confirm password"
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
      <Link href="/login" className="text-sm text-muted-foreground hover:underline">
        Already have an account? Sign in
      </Link>
    </div>
  )
}
