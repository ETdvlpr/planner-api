import { Injectable } from '@nestjs/common';
import { ActivitySource, type ActivityEntry } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import type {
  ActivityQueryDto,
  LogActivityDto,
  UpdateActivityDto,
} from './activity.dto';

@Injectable()
export class ActivityService extends ScopedCrudService<ActivityEntry> {
  protected readonly model = 'activityEntry';
  protected defaultOrderBy = [{ occurredAt: 'desc' as const }];

  constructor(prisma: PrismaService, seq: SeqService) {
    super(prisma, seq);
  }

  find(userId: string, query: ActivityQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.source) where.source = query.source;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.q) {
      where.description = { contains: query.q, mode: 'insensitive' };
    }
    return this.list(userId, query, where);
  }

  /**
   * Logs work that was done without ever being a task.
   *
   * Much real work never existed as a task first, and a system that can only
   * record what was planned gives a false picture of the week.
   */
  async log(userId: string, dto: LogActivityDto) {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    await this.assertOwnedOrNull(userId, 'task', dto.taskId);
    await this.assertOwnedOrNull(userId, 'meeting', dto.meetingId);

    return this.create(userId, {
      ...dto,
      source: dto.source ?? ActivitySource.manual,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    });
  }

  updateActivity(userId: string, id: string, dto: UpdateActivityDto) {
    const data: Record<string, unknown> = { ...dto };
    if (dto.occurredAt) data.occurredAt = new Date(dto.occurredAt);
    return this.update(userId, id, data);
  }

  /**
   * The weekly review: planned and unplanned work side by side.
   *
   * Splitting the two is the point. A week that looks empty by task count is
   * usually a week that was spent entirely on work nobody planned.
   */
  async review(userId: string, from?: Date, to?: Date) {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

    const entries = await this.prisma.activityEntry.findMany({
      where: {
        userId,
        deletedAt: null,
        occurredAt: { gte: start, lte: end },
      },
      orderBy: { occurredAt: 'desc' },
    });

    const planned = entries.filter((e) => e.source !== ActivitySource.manual);
    const unplanned = entries.filter((e) => e.source === ActivitySource.manual);

    const byOrganization = new Map<string, number>();
    for (const entry of entries) {
      const key = entry.organizationId ?? 'unfiled';
      byOrganization.set(key, (byOrganization.get(key) ?? 0) + 1);
    }

    const carriedForward = await this.prisma.task.count({
      where: {
        userId,
        deletedAt: null,
        carriedForwardAt: { gte: start, lte: end },
      },
    });

    return {
      from: start,
      to: end,
      totals: {
        all: entries.length,
        planned: planned.length,
        unplanned: unplanned.length,
        carriedForward,
      },
      byOrganization: [...byOrganization].map(([organizationId, count]) => ({
        organizationId: organizationId === 'unfiled' ? null : organizationId,
        count,
      })),
      planned,
      unplanned,
    };
  }
}
