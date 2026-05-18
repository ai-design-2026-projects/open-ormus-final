-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_turns" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_turns_session_id_idx" ON "agent_turns"("session_id");

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
