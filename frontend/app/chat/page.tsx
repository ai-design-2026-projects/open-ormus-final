import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { listSessions } from "@/lib/agent/history";
import { ChatView } from "./_components/chat-view";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sessions = await listSessions(prisma, user.id);
  return <ChatView initialSessions={sessions} />;
}
