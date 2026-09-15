import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Meeting, MeetingNoteItem } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import type {
  CreateMeetingDto,
  CreateNoteItemDto,
  MarkProcessedDto,
  MeetingQueryDto,
  UpdateMeetingDto,
  UpdateNoteItemDto,
} from './meetings.dto';

@Injectable()
export class MeetingsService extends ScopedCrudService<Meeting> {
  protected readonly model = 'meeting';
  protected defaultOrderBy = [{ date: 'desc' as const }];

  constructor(prisma: PrismaService, seq: SeqService) {
    super(prisma, seq);
  }

  find(userId: string, query: MeetingQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { rawNotes: { contains: query.q, mode: 'insensitive' } },
        { attendees: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return this.list(userId, query, where);
  }

  async createMeeting(userId: string, dto: CreateMeetingDto): Promise<Meeting> {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    return this.create(userId, {
      ...dto,
      date: new Date(dto.date),
      rawNotes: dto.rawNotes ?? '',
    });
  }

  async updateMeeting(
    userId: string,
    id: string,
    dto: UpdateMeetingDto,
  ): Promise<Meeting> {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    const data: Record<string, unknown> = { ...dto };
    if (dto.date) data.date = new Date(dto.date);
    return this.update(userId, id, data);
  }

  /**
   * "6 notes captured, 4 processed, 2 still need review" — the number that
   * tells you whether a meeting has actually been dealt with.
   */
  async processingStatus(userId: string, meetingId: string) {
    await this.findOne(userId, meetingId);
    const [captured, processed] = await Promise.all([
      this.prisma.meetingNoteItem.count({
        where: { userId, meetingId, deletedAt: null },
      }),
      this.prisma.meetingNoteItem.count({
        where: { userId, meetingId, deletedAt: null, processed: true },
      }),
    ]);
    return { captured, processed, remaining: captured - processed };
  }

  // ─────────────────────────────────────────────────────────────── note items

  noteItems(userId: string, meetingId: string): Promise<MeetingNoteItem[]> {
    return this.prisma.meetingNoteItem.findMany({
      where: { userId, meetingId, deletedAt: null },
      orderBy: { position: 'asc' },
    });
  }

  async addNoteItem(
    userId: string,
    meetingId: string,
    dto: CreateNoteItemDto,
  ): Promise<MeetingNoteItem> {
    await this.findOne(userId, meetingId);
    const now = new Date();
    return this.prisma.meetingNoteItem.create({
      data: {
        id: dto.id ?? randomUUID(),
        userId,
        meetingId,
        content: dto.content,
        position: dto.position ?? 0,
        createdAt: now,
        updatedAt: now,
        seq: await this.seq.next(userId),
      },
    });
  }

  /**
   * Derives note items from the meeting's raw notes, one per non-empty line.
   *
   * The raw text is never rewritten. That is the whole reason capture is safe
   * during a meeting: the record of what was said cannot be damaged by what is
   * done with it afterwards.
   */
  async splitRawNotes(
    userId: string,
    meetingId: string,
    replace = false,
  ): Promise<MeetingNoteItem[]> {
    const meeting = await this.findOne(userId, meetingId);
    const existing = await this.noteItems(userId, meetingId);

    if (existing.length > 0 && !replace) {
      throw new BadRequestException(
        'Meeting already has note items — pass `replace: true` to rebuild ' +
          'them, which discards what was already marked processed',
      );
    }

    const lines = meeting.rawNotes
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const now = new Date();
    const seqBase = await this.seq.allocate(
      userId,
      existing.length + lines.length,
    );

    return this.prisma.$transaction(async (tx) => {
      let seq = seqBase;

      for (const item of existing) {
        await tx.meetingNoteItem.update({
          where: { id: item.id },
          data: { deletedAt: now, updatedAt: now, seq: ++seq },
        });
      }

      const created: MeetingNoteItem[] = [];
      for (const [index, line] of lines.entries()) {
        created.push(
          await tx.meetingNoteItem.create({
            data: {
              id: randomUUID(),
              userId,
              meetingId,
              content: line,
              position: index,
              createdAt: now,
              updatedAt: now,
              seq: ++seq,
            },
          }),
        );
      }
      return created;
    });
  }

  async updateNoteItem(
    userId: string,
    itemId: string,
    dto: UpdateNoteItemDto,
  ): Promise<MeetingNoteItem> {
    await this.ownedNoteItem(userId, itemId);
    return this.prisma.meetingNoteItem.update({
      where: { id: itemId },
      data: {
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.processed !== undefined ? { processed: dto.processed } : {}),
        updatedAt: new Date(),
        seq: await this.seq.next(userId),
      },
    });
  }

  /** Records what a raw note line turned into. */
  async markProcessed(
    userId: string,
    itemId: string,
    dto: MarkProcessedDto,
  ): Promise<MeetingNoteItem> {
    await this.ownedNoteItem(userId, itemId);
    const now = new Date();
    return this.prisma.meetingNoteItem.update({
      where: { id: itemId },
      data: {
        processed: true,
        resultKind: dto.resultKind,
        resultId: dto.resultId ?? null,
        processedAt: now,
        updatedAt: now,
        seq: await this.seq.next(userId),
      },
    });
  }

  async removeNoteItem(
    userId: string,
    itemId: string,
  ): Promise<MeetingNoteItem> {
    await this.ownedNoteItem(userId, itemId);
    const now = new Date();
    return this.prisma.meetingNoteItem.update({
      where: { id: itemId },
      data: {
        deletedAt: now,
        updatedAt: now,
        seq: await this.seq.next(userId),
      },
    });
  }

  private async ownedNoteItem(userId: string, itemId: string) {
    const item = await this.prisma.meetingNoteItem.findFirst({
      where: { id: itemId, userId, deletedAt: null },
    });
    if (!item) throw new BadRequestException('Note item not found');
    return item;
  }
}
