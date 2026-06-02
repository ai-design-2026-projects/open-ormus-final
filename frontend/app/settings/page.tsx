import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { SettingsForms } from "./_components/settings-forms"

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  return <SettingsForms email={user.email ?? ""} />
}
