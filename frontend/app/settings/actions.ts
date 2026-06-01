"use server"

import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { z } from "zod"

export type SettingsActionState = { error: string | null; success?: string }

const emailSchema = z.object({ email: z.string().email() })
const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((d) => d.password !== d.currentPassword, {
    message: "New password must be different from your current password",
    path: ["password"],
  })

export async function changeEmail(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  if (parsed.data.email === user.email) {
    return { error: "New email must be different from your current email" }
  }

  const { error } = await supabase.auth.updateUser({ email: parsed.data.email })
  if (error) return { error: error.message }

  return { error: null, success: "Check your inbox to confirm the change." }
}

export async function changePassword(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: parsed.data.currentPassword,
  })
  if (authError) return { error: "Current password is incorrect" }

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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { error: "Server misconfiguration" }

  const userId = user.id

  // Delete from Supabase auth first — if this fails, DB is untouched and
  // the user remains fully functional.
  const admin = createAdminClient(url, key)
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)
  if (authDeleteError) return { error: authDeleteError.message }

  // Message has onDelete: Restrict on characterId — must be deleted before User cascade
  // removes Characters. Everything else cascades automatically from User.
  const convIds = (
    await prisma.conversation.findMany({ where: { userId }, select: { id: true } })
  ).map((c) => c.id)
  await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } })
  await prisma.user.delete({ where: { id: userId } })

  await supabase.auth.signOut()
  redirect("/login")
}
