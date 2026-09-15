-- CreateEnum
CREATE TYPE "DeadlinePrecision" AS ENUM ('day', 'week');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deadline_precision" "DeadlinePrecision" NOT NULL DEFAULT 'day';
