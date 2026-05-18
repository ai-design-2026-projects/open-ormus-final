-- DropIndex
DROP INDEX "idx_characters_name_trgm";

-- AlterTable
ALTER TABLE "conversation_participants" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "messages" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "conversation_jobs" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "total_turns" INTEGER NOT NULL,
    "done_turns" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_jobs_conversation_id_idx" ON "conversation_jobs"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_jobs_user_id_idx" ON "conversation_jobs"("user_id");

-- AddForeignKey
ALTER TABLE "conversation_jobs" ADD CONSTRAINT "conversation_jobs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_jobs" ADD CONSTRAINT "conversation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
