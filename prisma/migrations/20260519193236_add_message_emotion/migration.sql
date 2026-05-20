-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "emotion" TEXT NOT NULL DEFAULT 'Joy',
ADD COLUMN     "intensity" TEXT NOT NULL DEFAULT 'low',
ADD COLUMN     "subtext" TEXT NOT NULL DEFAULT '';
