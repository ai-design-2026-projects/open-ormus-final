-- CreateEnum
CREATE TYPE "LlmUsageSource" AS ENUM ('CONVERSATION', 'ORCHESTRATOR', 'AGENT_SESSION', 'IMPROVE_CONTEXT', 'OTHER');

-- CreateTable
CREATE TABLE "llm_usages" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "LlmUsageSource" NOT NULL,
    "conversation_id" UUID,
    "agent_session_id" UUID,
    "user_id" UUID,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "reasoning_tokens" INTEGER,
    "cached_tokens" INTEGER,
    "cost_usd" DOUBLE PRECISION,
    "latency_ms" INTEGER NOT NULL,

    CONSTRAINT "llm_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_usages_conversation_id_idx" ON "llm_usages"("conversation_id");

-- CreateIndex
CREATE INDEX "llm_usages_agent_session_id_idx" ON "llm_usages"("agent_session_id");

-- CreateIndex
CREATE INDEX "llm_usages_user_id_idx" ON "llm_usages"("user_id");

-- AddForeignKey
ALTER TABLE "llm_usages" ADD CONSTRAINT "llm_usages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_usages" ADD CONSTRAINT "llm_usages_agent_session_id_fkey" FOREIGN KEY ("agent_session_id") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_usages" ADD CONSTRAINT "llm_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
