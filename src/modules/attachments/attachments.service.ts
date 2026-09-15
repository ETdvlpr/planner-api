import { BadRequestException, Injectable } from '@nestjs/common';
import type { Attachment } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { ScopedCrudService } from '../../common/crud/scoped-crud.service';
import { StorageService } from '../storage/storage.service';
import type {
  AttachmentQueryDto,
  CreateAttachmentDto,
  RequestUploadDto,
  UpdateAttachmentDto,
} from './attachments.dto';

/**
 * Attachment rows. The bytes are R2's problem.
 *
 * Creating an attachment is two steps by design: `POST /attachments` returns
 * the row *and* a presigned URL, the client PUTs to R2, then confirms. The row
 * exists before the upload so a failed or abandoned upload is visible as a row
 * with no `objectKey`, rather than as nothing at all.
 */
@Injectable()
export class AttachmentsService extends ScopedCrudService<Attachment> {
  protected readonly model = 'attachment';
  protected defaultOrderBy = [{ createdAt: 'desc' as const }];

  constructor(
    prisma: PrismaService,
    seq: SeqService,
    private readonly storage: StorageService,
  ) {
    super(prisma, seq);
  }

  find(userId: string, query: AttachmentQueryDto) {
    const where: Record<string, unknown> = {};
    for (const key of [
      'kind',
      'taskId',
      'meetingId',
      'projectId',
      'noteId',
      'requirementId',
    ] as const) {
      if (query[key]) where[key] = query[key];
    }
    return this.list(userId, query, where);
  }

  async createWithUpload(userId: string, dto: CreateAttachmentDto) {
    await this.assertLinks(userId, dto);

    const upload = await this.storage.presignUpload(
      userId,
      dto.fileName,
      dto.mimeType,
      dto.sizeBytes,
    );

    const attachment = await this.create(userId, {
      id: dto.id,
      kind: dto.kind,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      caption: dto.caption ?? null,
      organizationId: dto.organizationId ?? null,
      projectId: dto.projectId ?? null,
      taskId: dto.taskId ?? null,
      meetingId: dto.meetingId ?? null,
      noteId: dto.noteId ?? null,
      requirementId: dto.requirementId ?? null,
      // Empty until the client confirms: web-created attachments have no path
      // on any device, and the mobile app overwrites this with its own.
      relativePath: '',
    });

    return { attachment, upload };
  }

  /**
   * A presigned URL for a row the server already holds.
   *
   * The mobile app replicates the row first and uploads the bytes later, so
   * it needs this rather than `createWithUpload`. Re-requesting is harmless:
   * a fresh key is minted each time and only the confirmed one is recorded.
   * The row's own metadata is refreshed from what the client is about to
   * send, so a web-created row with no size gets one.
   */
  async requestUpload(userId: string, id: string, dto: RequestUploadDto) {
    const attachment = await this.findOne(userId, id);
    const upload = await this.storage.presignUpload(
      userId,
      dto.fileName,
      dto.mimeType,
      dto.sizeBytes,
    );
    if (attachment.mimeType !== dto.mimeType) {
      await this.update(userId, id, { mimeType: dto.mimeType });
    }
    return { upload };
  }

  /**
   * Marks the upload complete after verifying the object is really there.
   *
   * The check is not ceremony: without it a client that crashed mid-PUT would
   * leave a row claiming to have media, and every later read of it would 404
   * with no way to tell why.
   */
  async confirmUpload(userId: string, id: string, objectKey: string) {
    await this.findOne(userId, id);
    this.storage.assertOwnedKey(userId, objectKey);

    const head = await this.storage.head(objectKey);
    if (head.sizeBytes === 0) {
      throw new BadRequestException('Uploaded object is empty');
    }

    return this.update(userId, id, {
      objectKey,
      uploadedAt: new Date(),
      sizeBytes: head.sizeBytes,
    });
  }

  /** A short-lived URL for viewing the file. */
  async downloadUrl(userId: string, id: string) {
    const attachment = await this.findOne(userId, id);
    if (!attachment.objectKey) {
      throw new BadRequestException(
        'This attachment has not been uploaded to object storage yet',
      );
    }
    return { url: await this.storage.presignDownload(attachment.objectKey) };
  }

  updateAttachment(userId: string, id: string, dto: UpdateAttachmentDto) {
    return this.update(userId, id, { ...dto });
  }

  /**
   * Soft-deletes the row. The object stays in R2.
   *
   * Deleting the bytes here would make the tombstone unrecoverable the moment
   * it replicated, and a mistaken delete on a phone is a normal event. Reaping
   * objects belonging to rows tombstoned long ago is a separate, deliberate
   * job — see `jobs/reap-orphaned-objects.ts`.
   */
  removeAttachment(userId: string, id: string) {
    return this.remove(userId, id);
  }

  private async assertLinks(
    userId: string,
    dto: CreateAttachmentDto | UpdateAttachmentDto,
  ) {
    await this.assertOwnedOrNull(userId, 'organization', dto.organizationId);
    await this.assertOwnedOrNull(userId, 'project', dto.projectId);
    await this.assertOwnedOrNull(userId, 'task', dto.taskId);
    await this.assertOwnedOrNull(userId, 'meeting', dto.meetingId);
    await this.assertOwnedOrNull(userId, 'note', dto.noteId);
    await this.assertOwnedOrNull(userId, 'requirement', dto.requirementId);
  }
}
