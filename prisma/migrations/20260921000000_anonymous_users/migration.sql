-- AlterTable
ALTER TABLE "users" ADD COLUMN     "anonymous" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "users_anonymous_last_seen_at_idx" ON "users"("anonymous", "last_seen_at");
