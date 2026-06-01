-- CreateTable
CREATE TABLE "character_pictures" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,

    CONSTRAINT "character_pictures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "character_pictures_user_id_idx" ON "character_pictures"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_pictures_character_id_size_key" ON "character_pictures"("character_id", "size");

-- AddForeignKey
ALTER TABLE "character_pictures" ADD CONSTRAINT "character_pictures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_pictures" ADD CONSTRAINT "character_pictures_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
