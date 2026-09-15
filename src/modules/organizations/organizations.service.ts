import { Injectable } from '@nestjs/common';
import { OrgStatus, type Organization } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import type {
  CreateOrganizationDto,
  OrganizationQueryDto,
  UpdateOrganizationDto,
} from './organizations.dto';

@Injectable()
export class OrganizationsService extends ScopedCrudService<Organization> {
  protected readonly model = 'organization';
  protected defaultOrderBy = [
    { sortOrder: 'asc' as const },
    { name: 'asc' as const },
  ];

  constructor(prisma: PrismaService, seq: SeqService) {
    super(prisma, seq);
  }

  find(userId: string, query: OrganizationQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return this.list(userId, query, where);
  }

  createOrganization(userId: string, dto: CreateOrganizationDto) {
    return this.create(userId, {
      ...dto,
      status: dto.status ?? OrgStatus.active,
    });
  }

  updateOrganization(userId: string, id: string, dto: UpdateOrganizationDto) {
    return this.update(userId, id, { ...dto });
  }

  /**
   * Counts of the open work hanging off an organization — what the dashboard
   * needs, in one round trip instead of four.
   */
  async summary(userId: string, id: string) {
    const organization = await this.findOne(userId, id);
    const scope = { userId, organizationId: id, deletedAt: null };

    const [projects, openTasks, meetings, requirements] = await Promise.all([
      this.prisma.project.count({
        where: { ...scope, status: { in: ['active', 'paused'] } },
      }),
      this.prisma.task.count({
        where: { ...scope, status: { in: ['next', 'inProgress', 'waiting'] } },
      }),
      this.prisma.meeting.count({ where: scope }),
      this.prisma.requirement.count({
        where: {
          ...scope,
          status: { in: ['unreviewed', 'accepted', 'planned'] },
        },
      }),
    ]);

    return {
      organization,
      counts: { projects, openTasks, meetings, openRequirements: requirements },
    };
  }
}
