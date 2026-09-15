import { Injectable } from '@nestjs/common';
import { ProjectStatus, type Project } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import type {
  CreateProjectDto,
  ProjectQueryDto,
  UpdateProjectDto,
} from './projects.dto';

@Injectable()
export class ProjectsService extends ScopedCrudService<Project> {
  protected readonly model = 'project';
  protected defaultOrderBy = [
    { sortOrder: 'asc' as const },
    { name: 'asc' as const },
  ];

  constructor(prisma: PrismaService, seq: SeqService) {
    super(prisma, seq);
  }

  find(userId: string, query: ProjectQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.unassigned) where.organizationId = null;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return this.list(userId, query, where);
  }

  async createProject(userId: string, dto: CreateProjectDto) {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    return this.create(userId, {
      ...dto,
      status: dto.status ?? ProjectStatus.active,
    });
  }

  async updateProject(userId: string, id: string, dto: UpdateProjectDto) {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    return this.update(userId, id, { ...dto });
  }
}
