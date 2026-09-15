import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ActivitySource,
  DeadlinePrecision,
  TaskPriority,
  TaskStatus,
  TaskType,
  type ChecklistItem,
  type Task,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import { RecurrenceService } from '../recurrence/recurrence.service';
import { reminderFor } from '../recurrence/recurrence.spec-model';
import type {
  CreateChecklistItemDto,
  CreateTaskDto,
  RecurrenceSpecDto,
  TaskQueryDto,
  UpdateChecklistItemDto,
  UpdateTaskDto,
} from './tasks.dto';

/** Statuses that still represent work the user owes someone. */
const OPEN_STATUSES = [
  TaskStatus.next,
  TaskStatus.inProgress,
  TaskStatus.waiting,
];

@Injectable()
export class TasksService extends ScopedCrudService<Task> {
  protected readonly model = 'task';
  protected defaultOrderBy = [
    { sortOrder: 'asc' as const },
    { createdAt: 'desc' as const },
  ];

  constructor(
    prisma: PrismaService,
    seq: SeqService,
    private readonly recurrence: RecurrenceService,
  ) {
    super(prisma, seq);
  }

  find(userId: string, query: TaskQueryDto) {
    const where: Record<string, unknown> = {};

    if (query.status?.length) where.status = { in: query.status };
    if (query.openOnly) where.status = { in: OPEN_STATUSES };
    if (query.type) where.type = query.type;
    if (query.priority) where.priority = query.priority;
    if (query.context) where.context = query.context;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.parentTaskId) where.parentTaskId = query.parentTaskId;
    if (query.recurringSeriesId)
      where.recurringSeriesId = query.recurringSeriesId;
    if (query.dueBefore) where.deadline = { lte: new Date(query.dueBefore) };

    // The Inbox is "captured but not yet filed" — no project, no organization.
    if (query.inbox) {
      where.organizationId = null;
      where.projectId = null;
    }

    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    return this.list(userId, query, where);
  }

  async createTask(userId: string, dto: CreateTaskDto): Promise<Task> {
    await this.assertParents(userId, dto);

    const { recurrence, ...fields } = dto;
    let recurrenceRuleId: string | null = null;
    let recurringSeriesId: string | null = null;
    let reminderAt = fields.reminderAt ? new Date(fields.reminderAt) : null;

    if (recurrence) {
      const rule = await this.createRecurrenceRule(userId, recurrence);
      recurrenceRuleId = rule.id;
      // Every occurrence of one obligation shares this id, forever. It is what
      // makes "have I filed VAT every quarter?" answerable.
      recurringSeriesId = randomUUID();
      if (!reminderAt && fields.deadline) {
        reminderAt = reminderFor(
          this.recurrence.toSpec(rule),
          new Date(fields.deadline),
        );
      }
    }

    return this.create(userId, {
      ...fields,
      type: fields.type ?? TaskType.projectWork,
      status: fields.status ?? TaskStatus.inbox,
      priority: fields.priority ?? TaskPriority.p2,
      deadline: fields.deadline ? new Date(fields.deadline) : null,
      deadlinePrecision: fields.deadline
        ? (fields.deadlinePrecision ?? DeadlinePrecision.day)
        : DeadlinePrecision.day,
      followUpDate: fields.followUpDate ? new Date(fields.followUpDate) : null,
      reminderAt,
      recurrenceRuleId,
      recurringSeriesId,
    });
  }

  async updateTask(
    userId: string,
    id: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    await this.assertParents(userId, dto);
    const { recurrence, ...fields } = dto;
    void recurrence; // changing a rule is `PUT /tasks/:id/recurrence`, not a patch

    const data: Record<string, unknown> = { ...fields };
    if (fields.deadline !== undefined) {
      data.deadline = fields.deadline ? new Date(fields.deadline) : null;
      // Precision only means something next to a date.
      if (!fields.deadline) data.deadlinePrecision = DeadlinePrecision.day;
    }
    if (fields.reminderAt !== undefined) {
      data.reminderAt = fields.reminderAt ? new Date(fields.reminderAt) : null;
    }
    if (fields.followUpDate !== undefined) {
      data.followUpDate = fields.followUpDate
        ? new Date(fields.followUpDate)
        : null;
    }

    return this.update(userId, id, data);
  }

  /**
   * Completes a task.
   *
   * Two things always happen, and one sometimes does:
   *
   * - The task is marked done. (always)
   * - An Activity entry is written. (always) It outlives the task — if the task
   *   is later deleted the entry keeps the record that the work happened, which
   *   is why "what did I do last week?" stays answerable.
   * - If the task recurs, the next occurrence is created as a **new row**.
   */
  async complete(
    userId: string,
    id: string,
    completedAt?: Date,
  ): Promise<{ task: Task; next: Task | null }> {
    const task = await this.findOne(userId, id);
    if (task.status === TaskStatus.done) {
      return { task, next: null };
    }

    const when = completedAt ?? new Date();
    const seqBase = await this.seq.allocate(userId, 2);

    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.done,
          completedAt: when,
          droppedAt: null,
          updatedAt: when,
          seq: seqBase + 1n,
        },
      });

      await tx.activityEntry.create({
        data: {
          id: randomUUID(),
          userId,
          organizationId: task.organizationId,
          projectId: task.projectId,
          taskId: task.id,
          description: task.title,
          source: RecurrenceService.activitySourceFor(task),
          occurredAt: when,
          createdAt: when,
          updatedAt: when,
          seq: seqBase + 2n,
        },
      });

      return done;
    });

    const next = await this.recurrence.spawnNextOccurrence(userId, task, when);
    return { task: updated, next };
  }

  /** Reopens a completed task. The Activity entry stays — it still happened. */
  async reopen(userId: string, id: string): Promise<Task> {
    await this.findOne(userId, id);
    return this.update(userId, id, {
      status: TaskStatus.next,
      completedAt: null,
      droppedAt: null,
    });
  }

  async drop(userId: string, id: string): Promise<Task> {
    await this.findOne(userId, id);
    return this.update(userId, id, {
      status: TaskStatus.dropped,
      droppedAt: new Date(),
    });
  }

  /**
   * Defers a task in the weekly review, recording that it was carried forward.
   * The count is what surfaces "this has been on your list for five weeks".
   */
  async carryForward(userId: string, id: string): Promise<Task> {
    const task = await this.findOne(userId, id);
    return this.update(userId, id, {
      carriedForwardAt: new Date(),
      carryForwardCount: task.carryForwardCount + 1,
    });
  }

  /**
   * Soft-deletes a task and clears the Activity links that pointed at it.
   *
   * On the client this was `ON DELETE SET NULL`. Here it is explicit, because a
   * database cascade and an application rule that disagree is exactly how the
   * two sides drift.
   */
  async removeTask(userId: string, id: string): Promise<Task> {
    const task = await this.findOne(userId, id);
    const children = await this.prisma.checklistItem.findMany({
      where: { userId, taskId: id, deletedAt: null },
      select: { id: true },
    });
    const activities = await this.prisma.activityEntry.findMany({
      where: { userId, taskId: id, deletedAt: null },
      select: { id: true },
    });

    const now = new Date();
    const seqBase = await this.seq.allocate(
      userId,
      1 + children.length + activities.length,
    );

    return this.prisma.$transaction(async (tx) => {
      let seq = seqBase;

      for (const child of children) {
        await tx.checklistItem.update({
          where: { id: child.id },
          data: { deletedAt: now, updatedAt: now, seq: ++seq },
        });
      }

      // Not deleted — decoupled. The record of the work outlives the task.
      for (const activity of activities) {
        await tx.activityEntry.update({
          where: { id: activity.id },
          data: { taskId: null, updatedAt: now, seq: ++seq },
        });
      }

      return tx.task.update({
        where: { id: task.id },
        data: { deletedAt: now, updatedAt: now, seq: ++seq },
      });
    });
  }

  /** Every occurrence of one recurring obligation, newest first. */
  seriesHistory(userId: string, recurringSeriesId: string) {
    return this.prisma.task.findMany({
      where: { userId, recurringSeriesId, deletedAt: null },
      orderBy: [{ deadline: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // ────────────────────────────────────────────────────────────── checklist

  checklist(userId: string, taskId: string): Promise<ChecklistItem[]> {
    return this.prisma.checklistItem.findMany({
      where: { userId, taskId, deletedAt: null },
      orderBy: { position: 'asc' },
    });
  }

  async addChecklistItem(
    userId: string,
    taskId: string,
    dto: CreateChecklistItemDto,
  ): Promise<ChecklistItem> {
    await this.findOne(userId, taskId);
    const now = new Date();
    return this.prisma.checklistItem.create({
      data: {
        id: dto.id ?? randomUUID(),
        userId,
        taskId,
        label: dto.label,
        done: dto.done ?? false,
        position: dto.position ?? 0,
        createdAt: now,
        updatedAt: now,
        seq: await this.seq.next(userId),
      },
    });
  }

  async updateChecklistItem(
    userId: string,
    itemId: string,
    dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItem> {
    await this.ownedChecklistItem(userId, itemId);
    return this.prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.done !== undefined ? { done: dto.done } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        updatedAt: new Date(),
        seq: await this.seq.next(userId),
      },
    });
  }

  async removeChecklistItem(
    userId: string,
    itemId: string,
  ): Promise<ChecklistItem> {
    await this.ownedChecklistItem(userId, itemId);
    const now = new Date();
    return this.prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        deletedAt: now,
        updatedAt: now,
        seq: await this.seq.next(userId),
      },
    });
  }

  // ────────────────────────────────────────────────────────────── internals

  private async ownedChecklistItem(userId: string, itemId: string) {
    const item = await this.prisma.checklistItem.findFirst({
      where: { id: itemId, userId, deletedAt: null },
    });
    if (!item) throw new BadRequestException('Checklist item not found');
    return item;
  }

  private async createRecurrenceRule(userId: string, dto: RecurrenceSpecDto) {
    const now = new Date();
    return this.prisma.recurrenceRule.create({
      data: {
        id: randomUUID(),
        userId,
        frequency: dto.frequency,
        interval: dto.interval ?? 1,
        weekdaysMask: dto.weekdaysMask ?? null,
        dayOfMonth: dto.dayOfMonth ?? null,
        monthOfYear: dto.monthOfYear ?? null,
        reminderDaysBefore: dto.reminderDaysBefore ?? null,
        reminderMinuteOfDay: dto.reminderMinuteOfDay ?? null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        createdAt: now,
        updatedAt: now,
        seq: await this.seq.next(userId),
      },
    });
  }

  private async assertParents(
    userId: string,
    dto: CreateTaskDto | UpdateTaskDto,
  ): Promise<void> {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    await this.assertOwnedOrNull(userId, 'meeting', dto.sourceMeetingId);
    await this.assertOwnedOrNull(
      userId,
      'requirement',
      dto.sourceRequirementId,
    );

    if (dto.parentTaskId) {
      const parent = await this.prisma.task.findFirst({
        where: { id: dto.parentTaskId, userId, deletedAt: null },
        select: { id: true, parentTaskId: true },
      });
      if (!parent) throw new BadRequestException('Parent task does not exist');
      // One level of subtasks only. A tree here would need a tree everywhere:
      // in the review roll-up, in progress counts, in the mobile list widget.
      if (parent.parentTaskId) {
        throw new BadRequestException(
          'Subtasks are one level deep — the parent is already a subtask',
        );
      }
    }
  }

  /** Activity sources treated as "this task was completed". */
  static readonly COMPLETION_SOURCES = [
    ActivitySource.taskCompletion,
    ActivitySource.recurringTask,
  ];
}
