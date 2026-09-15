import { Injectable } from '@nestjs/common';
import {
  RequirementStatus,
  RequirementType,
  type Requirement,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import type {
  CreateRequirementDto,
  RequirementQueryDto,
  UpdateRequirementDto,
} from './requirements.dto';

const OPEN_STATUSES = [
  RequirementStatus.unreviewed,
  RequirementStatus.accepted,
  RequirementStatus.planned,
];

@Injectable()
export class RequirementsService extends ScopedCrudService<Requirement> {
  protected readonly model = 'requirement';
  protected defaultOrderBy = [{ createdAt: 'desc' as const }];

  constructor(prisma: PrismaService, seq: SeqService) {
    super(prisma, seq);
  }

  find(userId: string, query: RequirementQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.openOnly) where.status = { in: OPEN_STATUSES };
    if (query.type) where.type = query.type;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.sourceMeetingId) where.sourceMeetingId = query.sourceMeetingId;
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return this.list(userId, query, where);
  }

  async createRequirement(userId: string, dto: CreateRequirementDto) {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    await this.assertOwnedOrNull(userId, 'meeting', dto.sourceMeetingId);
    return this.create(userId, {
      ...dto,
      type: dto.type ?? RequirementType.requirement,
      status: dto.status ?? RequirementStatus.unreviewed,
    });
  }

  async updateRequirement(
    userId: string,
    id: string,
    dto: UpdateRequirementDto,
  ) {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    return this.update(userId, id, { ...dto });
  }
}
