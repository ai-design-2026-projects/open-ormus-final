import { createClient } from "@/lib/supabase/server"
import { LibraryPage } from "./_components/library-page"
import { LandingPage } from "./_components/landing-page"

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user ? <LibraryPage /> : <LandingPage />
}
