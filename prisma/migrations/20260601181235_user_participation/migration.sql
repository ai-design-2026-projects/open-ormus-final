-- DropIndex
DROP INDEX "conversation_participants_conversation_id_character_id_key";

-- AlterTable
ALTER TABLE "conversation_participants" ADD COLUMN     "is_user_participant" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "character_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "author_user_id" UUID,
ALTER COLUMN "character_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "display_name" TEXT NOT NULL DEFAULT '';

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
