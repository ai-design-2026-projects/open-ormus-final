import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { SettingsForms } from "./_components/settings-forms"

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  let displayName = ""
  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { displayName: true },
    })
    displayName = dbUser?.displayName ?? ""
  } catch {
    // fall through with empty displayName — user can still manage email/password
  }

  return <SettingsForms email={user.email ?? ""} displayName={displayName} />
}
