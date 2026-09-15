import { Injectable } from '@nestjs/common';
import type { Decision } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import type {
  CreateDecisionDto,
  DecisionQueryDto,
  UpdateDecisionDto,
} from './decisions.dto';

@Injectable()
export class DecisionsService extends ScopedCrudService<Decision> {
  protected readonly model = 'decision';
  protected defaultOrderBy = [{ date: 'desc' as const }];

  constructor(prisma: PrismaService, seq: SeqService) {
    super(prisma, seq);
  }

  find(userId: string, query: DecisionQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.sourceMeetingId) where.sourceMeetingId = query.sourceMeetingId;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.q) {
      where.OR = [
        { decision: { contains: query.q, mode: 'insensitive' } },
        { reason: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return this.list(userId, query, where);
  }

  async createDecision(userId: string, dto: CreateDecisionDto) {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    await this.assertOwnedOrNull(userId, 'meeting', dto.sourceMeetingId);
    return this.create(userId, {
      ...dto,
      date: dto.date ? new Date(dto.date) : new Date(),
    });
  }

  async updateDecision(userId: string, id: string, dto: UpdateDecisionDto) {
    const data: Record<string, unknown> = { ...dto };
    if (dto.date) data.date = new Date(dto.date);
    return this.update(userId, id, data);
  }
}
