import { BadRequestException, Injectable } from '@nestjs/common';
import type { VoiceNote } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import { StorageService } from '../storage/storage.service';
import type { RequestUploadDto } from '../attachments/attachments.dto';
import type {
  CreateVoiceNoteDto,
  UpdateVoiceNoteDto,
  VoiceNoteQueryDto,
} from './voice-notes.dto';

/**
 * Voice notes follow the same create → upload → confirm flow as attachments.
 *
 * `transcript` is never written here. Transcription needs ~1.5 GB and would
 * saturate the only core for minutes per clip, so it stays deferred until after
 * the server migration. The column and the seam exist; nothing fills them.
 */
@Injectable()
export class VoiceNotesService extends ScopedCrudService<VoiceNote> {
  protected readonly model = 'voiceNote';
  protected defaultOrderBy = [{ createdAt: 'desc' as const }];

  constructor(
    prisma: PrismaService,
    seq: SeqService,
    private readonly storage: StorageService,
  ) {
    super(prisma, seq);
  }

  find(userId: string, query: VoiceNoteQueryDto) {
    const where: Record<string, unknown> = {};
    for (const key of ['taskId', 'meetingId', 'projectId', 'noteId'] as const) {
      if (query[key]) where[key] = query[key];
    }
    return this.list(userId, query, where);
  }

  async createWithUpload(userId: string, dto: CreateVoiceNoteDto) {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    await this.assertOwnedOrNull(userId, 'task', dto.taskId);
    await this.assertOwnedOrNull(userId, 'meeting', dto.meetingId);
    await this.assertOwnedOrNull(userId, 'note', dto.noteId);

    const upload = await this.storage.presignUpload(
      userId,
      dto.fileName,
      dto.mimeType,
      dto.sizeBytes,
    );

    const voiceNote = await this.create(userId, {
      id: dto.id,
      title: dto.title ?? null,
      durationMs: dto.durationMs ?? 0,
      organizationId: dto.organizationId ?? null,
      projectId: dto.projectId ?? null,
      taskId: dto.taskId ?? null,
      meetingId: dto.meetingId ?? null,
      noteId: dto.noteId ?? null,
      relativePath: '',
    });

    return { voiceNote, upload };
  }

  /** A presigned URL for a row that replicated in before its bytes. */
  async requestUpload(userId: string, id: string, dto: RequestUploadDto) {
    await this.findOne(userId, id);
    const upload = await this.storage.presignUpload(
      userId,
      dto.fileName,
      dto.mimeType,
      dto.sizeBytes,
    );
    return { upload };
  }

  async confirmUpload(userId: string, id: string, objectKey: string) {
    await this.findOne(userId, id);
    this.storage.assertOwnedKey(userId, objectKey);

    const head = await this.storage.head(objectKey);
    if (head.sizeBytes === 0) {
      throw new BadRequestException('Uploaded object is empty');
    }

    return this.update(userId, id, { objectKey, uploadedAt: new Date() });
  }

  async downloadUrl(userId: string, id: string) {
    const voiceNote = await this.findOne(userId, id);
    if (!voiceNote.objectKey) {
      throw new BadRequestException(
        'This voice note has not been uploaded to object storage yet',
      );
    }
    return { url: await this.storage.presignDownload(voiceNote.objectKey) };
  }

  updateVoiceNote(userId: string, id: string, dto: UpdateVoiceNoteDto) {
    return this.update(userId, id, { ...dto });
  }
}
