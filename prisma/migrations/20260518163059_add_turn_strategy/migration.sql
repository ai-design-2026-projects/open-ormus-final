-- CreateEnum
CREATE TYPE "TurnStrategy" AS ENUM ('ORCHESTRATOR', 'ROUND_ROBIN');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "turn_strategy" "TurnStrategy" NOT NULL DEFAULT 'ORCHESTRATOR';
