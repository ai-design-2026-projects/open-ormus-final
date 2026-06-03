-- AlterTable
ALTER TABLE "agent_turns" ADD COLUMN     "item" JSONB,
ALTER COLUMN "content" SET DEFAULT '';
