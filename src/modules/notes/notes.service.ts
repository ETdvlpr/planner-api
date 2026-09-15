import { Injectable } from '@nestjs/common';
import type { Note } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import type { CreateNoteDto, NoteQueryDto, UpdateNoteDto } from './notes.dto';

@Injectable()
export class NotesService extends ScopedCrudService<Note> {
  protected readonly model = 'note';
  protected defaultOrderBy = [{ updatedAt: 'desc' as const }];

  constructor(prisma: PrismaService, seq: SeqService) {
    super(prisma, seq);
  }

  find(userId: string, query: NoteQueryDto) {
    const where: Record<string, unknown> = {};
    for (const key of [
      'organizationId',
      'projectId',
      'taskId',
      'meetingId',
      'requirementId',
    ] as const) {
      if (query[key]) where[key] = query[key];
    }
    if (!query.includeArchived) where.archivedAt = null;
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { body: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return this.list(userId, query, where);
  }

  async createNote(userId: string, dto: CreateNoteDto) {
    await this.assertLinks(userId, dto);
    return this.create(userId, { ...dto });
  }

  async updateNote(userId: string, id: string, dto: UpdateNoteDto) {
    await this.assertLinks(userId, dto);
    return this.update(userId, id, { ...dto });
  }

  /** Archiving hides a note from lists without tombstoning it. */
  archive(userId: string, id: string) {
    return this.update(userId, id, { archivedAt: new Date() });
  }

  unarchive(userId: string, id: string) {
    return this.update(userId, id, { archivedAt: null });
  }

  private async assertLinks(
    userId: string,
    dto: CreateNoteDto | UpdateNoteDto,
  ) {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    await this.assertOwnedOrNull(userId, 'task', dto.taskId);
    await this.assertOwnedOrNull(userId, 'meeting', dto.meetingId);
    await this.assertOwnedOrNull(userId, 'requirement', dto.requirementId);
  }
}
