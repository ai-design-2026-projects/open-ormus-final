-- DropIndex
DROP INDEX "agent_turns_session_id_idx";

-- AlterTable
ALTER TABLE "agent_turns" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "agent_turns_session_id_seq_idx" ON "agent_turns"("session_id", "seq");
