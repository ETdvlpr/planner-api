import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ActivitySource,
  TaskStatus,
  type RecurrenceRule,
  type Task,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import {
  nextAfter,
  reminderFor,
  type RecurrenceSpec,
} from './recurrence.spec-model';

/**
 * Owns "what happens after a recurring task is completed".
 *
 * This moved server-side deliberately. Once the web client can complete a
 * recurring task, the rule "create the next occurrence sharing
 * `recurringSeriesId`" needs exactly one home — two implementations would drift
 * and the filing history, which is the whole point of never reusing a row,
 * would stop being trustworthy.
 */
@Injectable()
export class RecurrenceService {
  private readonly logger = new Logger(RecurrenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SeqService,
  ) {}

  toSpec(rule: RecurrenceRule): RecurrenceSpec {
    return {
      frequency: rule.frequency,
      interval: rule.interval,
      weekdaysMask: rule.weekdaysMask,
      dayOfMonth: rule.dayOfMonth,
      monthOfYear: rule.monthOfYear,
      reminderDaysBefore: rule.reminderDaysBefore,
      reminderMinuteOfDay: rule.reminderMinuteOfDay,
      endDate: rule.endDate,
    };
  }

  /**
   * Creates the next occurrence of a completed recurring task, as a brand new
   * row. Returns null when the task does not recur or the series has ended.
   */
  async spawnNextOccurrence(
    userId: string,
    completed: Task,
    completedAt: Date,
  ): Promise<Task | null> {
    if (!completed.recurrenceRuleId || !completed.recurringSeriesId)
      return null;

    const rule = await this.prisma.recurrenceRule.findFirst({
      where: { id: completed.recurrenceRuleId, userId, deletedAt: null },
    });
    if (!rule) return null;

    const spec = this.toSpec(rule);
    // The next occurrence hangs off the *deadline*, not the completion date —
    // filing a VAT return three days late must not move every future return
    // three days later.
    const anchor = completed.deadline ?? completedAt;
    const nextDue = nextAfter(spec, anchor);
    if (!nextDue) return null;

    // Completing the same occurrence twice (an undo, a replayed sync push)
    // must not fork the series.
    const existing = await this.prisma.task.findFirst({
      where: {
        userId,
        recurringSeriesId: completed.recurringSeriesId,
        deadline: nextDue,
        deletedAt: null,
      },
    });
    if (existing) return existing;

    const now = new Date();
    const nextId = randomUUID();

    // The checklist template carries forward unticked, so a recurring
    // obligation keeps its steps.
    const template = await this.prisma.checklistItem.findMany({
      where: { userId, taskId: completed.id, deletedAt: null },
      orderBy: { position: 'asc' },
    });

    const seqBase = await this.seq.allocate(userId, 1 + template.length);

    return this.prisma.$transaction(async (tx) => {
      let seq = seqBase;
      const next = await tx.task.create({
        data: {
          id: nextId,
          userId,
          organizationId: completed.organizationId,
          projectId: completed.projectId,
          recurrenceRuleId: completed.recurrenceRuleId,
          recurringSeriesId: completed.recurringSeriesId,
          title: completed.title,
          description: completed.description,
          type: completed.type,
          status: TaskStatus.next,
          priority: completed.priority,
          context: completed.context,
          deadline: nextDue,
          reminderAt: reminderFor(spec, nextDue),
          createdAt: now,
          updatedAt: now,
          seq: ++seq,
        },
      });

      for (const item of template) {
        await tx.checklistItem.create({
          data: {
            id: randomUUID(),
            userId,
            taskId: next.id,
            label: item.label,
            position: item.position,
            createdAt: now,
            updatedAt: now,
            seq: ++seq,
          },
        });
      }

      return next;
    });
  }

  /**
   * Sweep for occurrences that were never materialised because the completion
   * happened offline on a device that has not synced.
   *
   * Run from a systemd timer rather than an in-process cron: a timer costs
   * nothing while idle, and on a box where memory is the binding constraint a
   * resident scheduler is a cost paid every minute for work done once a day.
   */
  async materialiseDueSeries(horizonDays = 1): Promise<{ created: number }> {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + horizonDays);

    // A series needs attention when its most recent occurrence is complete and
    // no open occurrence exists.
    const completed = await this.prisma.task.findMany({
      where: {
        deletedAt: null,
        status: TaskStatus.done,
        recurringSeriesId: { not: null },
        recurrenceRuleId: { not: null },
        completedAt: { not: null },
      },
      orderBy: { completedAt: 'desc' },
    });

    const seen = new Set<string>();
    let created = 0;

    for (const task of completed) {
      const series = task.recurringSeriesId!;
      if (seen.has(series)) continue;
      seen.add(series);

      const open = await this.prisma.task.count({
        where: {
          userId: task.userId,
          recurringSeriesId: series,
          deletedAt: null,
          status: { notIn: [TaskStatus.done, TaskStatus.dropped] },
        },
      });
      if (open > 0) continue;

      const next = await this.spawnNextOccurrence(
        task.userId,
        task,
        task.completedAt ?? new Date(),
      );
      if (next && next.deadline && next.deadline <= horizon) created += 1;
    }

    this.logger.log(
      `Recurrence sweep: ${seen.size} series checked, ${created} occurrences created`,
    );
    return { created };
  }

  /** Activity source for a completion, so history distinguishes the two. */
  static activitySourceFor(task: Task): ActivitySource {
    return task.recurringSeriesId
      ? ActivitySource.recurringTask
      : ActivitySource.taskCompletion;
  }
}
