-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'paused', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('projectWork', 'admin', 'followUp', 'investigation', 'personal');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('inbox', 'next', 'inProgress', 'waiting', 'done', 'dropped', 'someday');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('p1', 'p2', 'p3');

-- CreateEnum
CREATE TYPE "TaskContextTag" AS ENUM ('quick', 'deepWork', 'call', 'review', 'computer', 'errand', 'meeting');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('feature', 'requirement', 'idea', 'investigation', 'question');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('unreviewed', 'accepted', 'planned', 'rejected', 'implemented');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('taskCompletion', 'manual', 'recurringTask', 'meeting', 'note');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('screenshot', 'image', 'file');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('daily', 'weekly', 'monthly', 'yearly', 'selectedWeekdays', 'everyNWeeks', 'everyNMonths');

-- CreateEnum
CREATE TYPE "ProcessedItemKind" AS ENUM ('task', 'requirement', 'feature', 'idea', 'investigation', 'followUp', 'decision', 'question', 'note');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "photo_url" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "user_id" UUID NOT NULL,
    "last_seq" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sync_clients" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "platform" TEXT,
    "app_version" TEXT,
    "last_pulled_seq" BIGINT NOT NULL DEFAULT 0,
    "last_pushed_at" TIMESTAMP(3),
    "last_pulled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "OrgStatus" NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "icon_code_point" INTEGER,
    "color_value" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "icon_code_point" INTEGER,
    "color_value" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence_rules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays_mask" INTEGER,
    "day_of_month" INTEGER,
    "month_of_year" INTEGER,
    "reminder_days_before" INTEGER,
    "reminder_minute_of_day" INTEGER,
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "recurrence_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "project_id" UUID,
    "source_meeting_id" UUID,
    "source_requirement_id" UUID,
    "parent_task_id" UUID,
    "recurrence_rule_id" UUID,
    "recurring_series_id" UUID,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "type" "TaskType" NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "priority" "TaskPriority" NOT NULL,
    "context" "TaskContextTag",
    "waiting_on" TEXT,
    "deadline" TIMESTAMP(3),
    "reminder_at" TIMESTAMP(3),
    "follow_up_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "dropped_at" TIMESTAMP(3),
    "carried_forward_at" TIMESTAMP(3),
    "carry_forward_count" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "project_id" UUID,
    "title" VARCHAR(300) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "attendees" TEXT,
    "raw_notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_note_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "result_kind" "ProcessedItemKind",
    "result_id" UUID,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "meeting_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "project_id" UUID,
    "source_meeting_id" UUID,
    "source_note_item_id" UUID,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "type" "RequirementType" NOT NULL,
    "status" "RequirementStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "project_id" UUID,
    "task_id" UUID,
    "meeting_id" UUID,
    "requirement_id" UUID,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "project_id" UUID,
    "source_meeting_id" UUID,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "project_id" UUID,
    "task_id" UUID,
    "meeting_id" UUID,
    "text" TEXT NOT NULL,
    "source" "ActivitySource" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "activity_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "project_id" UUID,
    "task_id" UUID,
    "meeting_id" UUID,
    "note_id" UUID,
    "requirement_id" UUID,
    "kind" "AttachmentKind" NOT NULL,
    "relative_path" TEXT NOT NULL DEFAULT '',
    "object_key" TEXT,
    "uploaded_at" TIMESTAMP(3),
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "caption" TEXT,
    "ocr_text" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_notes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "project_id" UUID,
    "task_id" UUID,
    "meeting_id" UUID,
    "note_id" UUID,
    "title" TEXT,
    "relative_path" TEXT NOT NULL DEFAULT '',
    "object_key" TEXT,
    "uploaded_at" TIMESTAMP(3),
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "transcript" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "voice_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "sync_clients_user_id_idx" ON "sync_clients"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_clients_user_id_device_id_key" ON "sync_clients"("user_id", "device_id");

-- CreateIndex
CREATE INDEX "organizations_user_id_seq_idx" ON "organizations"("user_id", "seq");

-- CreateIndex
CREATE INDEX "organizations_user_id_status_idx" ON "organizations"("user_id", "status");

-- CreateIndex
CREATE INDEX "projects_user_id_seq_idx" ON "projects"("user_id", "seq");

-- CreateIndex
CREATE INDEX "projects_user_id_organization_id_idx" ON "projects"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "projects_user_id_status_idx" ON "projects"("user_id", "status");

-- CreateIndex
CREATE INDEX "recurrence_rules_user_id_seq_idx" ON "recurrence_rules"("user_id", "seq");

-- CreateIndex
CREATE INDEX "tasks_user_id_seq_idx" ON "tasks"("user_id", "seq");

-- CreateIndex
CREATE INDEX "tasks_user_id_status_idx" ON "tasks"("user_id", "status");

-- CreateIndex
CREATE INDEX "tasks_user_id_organization_id_idx" ON "tasks"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_project_id_idx" ON "tasks"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_deadline_idx" ON "tasks"("user_id", "deadline");

-- CreateIndex
CREATE INDEX "tasks_user_id_recurring_series_id_idx" ON "tasks"("user_id", "recurring_series_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_parent_task_id_idx" ON "tasks"("user_id", "parent_task_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_completed_at_idx" ON "tasks"("user_id", "completed_at");

-- CreateIndex
CREATE INDEX "tasks_source_meeting_id_idx" ON "tasks"("source_meeting_id");

-- CreateIndex
CREATE INDEX "tasks_source_requirement_id_idx" ON "tasks"("source_requirement_id");

-- CreateIndex
CREATE INDEX "tasks_recurrence_rule_id_idx" ON "tasks"("recurrence_rule_id");

-- CreateIndex
CREATE INDEX "checklist_items_user_id_seq_idx" ON "checklist_items"("user_id", "seq");

-- CreateIndex
CREATE INDEX "checklist_items_user_id_task_id_idx" ON "checklist_items"("user_id", "task_id");

-- CreateIndex
CREATE INDEX "meetings_user_id_seq_idx" ON "meetings"("user_id", "seq");

-- CreateIndex
CREATE INDEX "meetings_user_id_organization_id_idx" ON "meetings"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "meetings_user_id_project_id_idx" ON "meetings"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "meetings_user_id_date_idx" ON "meetings"("user_id", "date");

-- CreateIndex
CREATE INDEX "meeting_note_items_user_id_seq_idx" ON "meeting_note_items"("user_id", "seq");

-- CreateIndex
CREATE INDEX "meeting_note_items_user_id_meeting_id_idx" ON "meeting_note_items"("user_id", "meeting_id");

-- CreateIndex
CREATE INDEX "requirements_user_id_seq_idx" ON "requirements"("user_id", "seq");

-- CreateIndex
CREATE INDEX "requirements_user_id_project_id_idx" ON "requirements"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "requirements_user_id_organization_id_idx" ON "requirements"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "requirements_user_id_source_meeting_id_idx" ON "requirements"("user_id", "source_meeting_id");

-- CreateIndex
CREATE INDEX "notes_user_id_seq_idx" ON "notes"("user_id", "seq");

-- CreateIndex
CREATE INDEX "notes_user_id_organization_id_idx" ON "notes"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "notes_user_id_project_id_idx" ON "notes"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "notes_user_id_task_id_idx" ON "notes"("user_id", "task_id");

-- CreateIndex
CREATE INDEX "notes_user_id_meeting_id_idx" ON "notes"("user_id", "meeting_id");

-- CreateIndex
CREATE INDEX "notes_requirement_id_idx" ON "notes"("requirement_id");

-- CreateIndex
CREATE INDEX "decisions_user_id_seq_idx" ON "decisions"("user_id", "seq");

-- CreateIndex
CREATE INDEX "decisions_user_id_organization_id_idx" ON "decisions"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "decisions_user_id_project_id_idx" ON "decisions"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "decisions_source_meeting_id_idx" ON "decisions"("source_meeting_id");

-- CreateIndex
CREATE INDEX "activity_entries_user_id_seq_idx" ON "activity_entries"("user_id", "seq");

-- CreateIndex
CREATE INDEX "activity_entries_user_id_occurred_at_idx" ON "activity_entries"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_entries_user_id_organization_id_idx" ON "activity_entries"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "activity_entries_user_id_project_id_idx" ON "activity_entries"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "activity_entries_task_id_idx" ON "activity_entries"("task_id");

-- CreateIndex
CREATE INDEX "activity_entries_meeting_id_idx" ON "activity_entries"("meeting_id");

-- CreateIndex
CREATE INDEX "attachments_user_id_seq_idx" ON "attachments"("user_id", "seq");

-- CreateIndex
CREATE INDEX "attachments_user_id_task_id_idx" ON "attachments"("user_id", "task_id");

-- CreateIndex
CREATE INDEX "attachments_user_id_meeting_id_idx" ON "attachments"("user_id", "meeting_id");

-- CreateIndex
CREATE INDEX "attachments_user_id_project_id_idx" ON "attachments"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "attachments_note_id_idx" ON "attachments"("note_id");

-- CreateIndex
CREATE INDEX "attachments_requirement_id_idx" ON "attachments"("requirement_id");

-- CreateIndex
CREATE INDEX "voice_notes_user_id_seq_idx" ON "voice_notes"("user_id", "seq");

-- CreateIndex
CREATE INDEX "voice_notes_user_id_task_id_idx" ON "voice_notes"("user_id", "task_id");

-- CreateIndex
CREATE INDEX "voice_notes_user_id_meeting_id_idx" ON "voice_notes"("user_id", "meeting_id");

-- CreateIndex
CREATE INDEX "voice_notes_user_id_project_id_idx" ON "voice_notes"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "voice_notes_note_id_idx" ON "voice_notes"("note_id");

