import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

export interface PresignedUpload {
  objectKey: string;
  uploadUrl: string;
  expiresIn: number;
  /** Headers the client must send with the PUT, verbatim. */
  headers: Record<string, string>;
}

/**
 * Cloudflare R2, spoken to as S3.
 *
 * Bytes never pass through this API. The client asks for a presigned URL and
 * PUTs directly to R2, which keeps a 20 MB screenshot upload off a box with one
 * vCPU and no spare memory, and means media survives the server migration
 * untouched — the single most valuable property of putting it here on day one.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('storage.endpoint') ?? '';
    const accessKeyId = this.config.get<string>('storage.accessKey') ?? '';
    const secretAccessKey = this.config.get<string>('storage.secretKey') ?? '';
    this.bucket = this.config.get<string>('storage.bucket') ?? '';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      // Local development and CI run without R2 credentials. Everything except
      // the media endpoints works; those fail loudly rather than silently
      // handing out URLs that go nowhere.
      this.client = null;
      this.logger.warn(
        'Object storage not configured — media endpoints disabled',
      );
      return;
    }

    this.client = new S3Client({
      region: this.config.get<string>('storage.region') ?? 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /**
   * A URL the client can PUT one file to.
   *
   * The key is server-generated and namespaced by user. A client-supplied key
   * would let one account write into another's prefix, and the presigned URL
   * would happily authorise it.
   */
  async presignUpload(
    userId: string,
    fileName: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<PresignedUpload> {
    const client = this.requireClient();

    const maxBytes = this.config.get<number>('storage.maxUploadBytes') ?? 0;
    if (sizeBytes > maxBytes) {
      throw new BadRequestException(
        `File is ${sizeBytes} bytes; the limit is ${maxBytes}`,
      );
    }

    const objectKey = `u/${userId}/${randomUUID()}${extname(fileName).toLowerCase()}`;
    const expiresIn = this.config.get<number>('storage.uploadUrlTtl') ?? 900;

    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
        // Signed into the URL, so an oversized body is rejected by R2 rather
        // than by us after the bytes have already crossed the network.
        ContentLength: sizeBytes,
      }),
      { expiresIn },
    );

    return {
      objectKey,
      uploadUrl,
      expiresIn,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(sizeBytes),
      },
    };
  }

  /** A short-lived URL for reading one object. */
  async presignDownload(objectKey: string): Promise<string> {
    const client = this.requireClient();
    const expiresIn = this.config.get<number>('storage.downloadUrlTtl') ?? 3600;
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn },
    );
  }

  /** Confirms an upload actually landed, and how big it is. */
  async head(
    objectKey: string,
  ): Promise<{ sizeBytes: number; contentType?: string }> {
    const client = this.requireClient();
    const result = await client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    return {
      sizeBytes: result.ContentLength ?? 0,
      contentType: result.ContentType,
    };
  }

  async delete(objectKey: string): Promise<void> {
    const client = this.requireClient();
    await client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }

  /**
   * Rejects a key that does not belong to this user.
   *
   * Object keys round-trip through the client when it confirms an upload, so
   * the prefix is re-checked on the way back in. Every path that accepts a key
   * from a request must call this.
   */
  assertOwnedKey(userId: string, objectKey: string): void {
    if (!objectKey.startsWith(`u/${userId}/`)) {
      throw new BadRequestException('Object key does not belong to this user');
    }
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Object storage is not configured on this server',
      );
    }
    return this.client;
  }
}
