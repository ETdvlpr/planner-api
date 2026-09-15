import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export type SyncOp = 'upsert' | 'delete';

export class SyncChangeDto {
  @ApiProperty({ example: 'tasks', description: 'Wire table name' })
  @IsString()
  @IsNotEmpty()
  table: string;

  @ApiProperty({ example: '2f1c2d2e-6f0f-4c0d-9e1a-6f1a2b3c4d5e' })
  @IsUUID()
  id: string;

  @ApiProperty({ enum: ['upsert', 'delete'] })
  @IsIn(['upsert', 'delete'])
  op: SyncOp;

  @ApiProperty({
    description:
      'When the client last modified this row. The whole conflict rule is ' +
      'built on it, so it must be the row\'s real `updatedAt`, not "now".',
    example: '2026-09-10T08:31:00.000Z',
  })
  @IsString()
  @IsNotEmpty()
  updatedAt: string;

  @ApiPropertyOptional({
    description:
      'Column values. Required for `upsert`, ignored for `delete`. ' +
      '`userId`, `seq`, `deletedAt`, `objectKey` and `uploadedAt` are ' +
      'server-owned and discarded if present.',
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class SyncPushDto {
  @ApiProperty({
    description:
      'Stable per-install identifier. Used for the "which device is behind?" ' +
      'view and as the deterministic tie-breaker on equal timestamps.',
  })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiPropertyOptional({ example: 'ios' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ example: '1.4.0' })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiProperty({ type: [SyncChangeDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SyncChangeDto)
  changes: SyncChangeDto[];
}

export class SyncPullQueryDto {
  @ApiPropertyOptional({
    default: '0',
    description:
      'The cursor from the last successful pull. Rows with `seq` greater ' +
      'than this are returned. Sent as a string because the cursor is a 64-bit ' +
      'integer and JSON numbers are not.',
  })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({ default: 500, maximum: 2000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;

  @ApiPropertyOptional({ description: 'Stable per-install identifier' })
  @IsOptional()
  @IsString()
  deviceId?: string;
}

/** One rejected change, with the server row that beat it. */
export interface SyncConflict {
  table: string;
  id: string;
  reason: 'stale' | 'not_owned';
  serverUpdatedAt: string | null;
}

export interface SyncPushResult {
  applied: number;
  skipped: number;
  conflicts: SyncConflict[];
  /** The client's new cursor: pull from here to see its own writes echoed. */
  cursor: string;
}

export interface SyncPullResult {
  changes: Record<string, Record<string, unknown>[]>;
  cursor: string;
  hasMore: boolean;
  /** Total rows in this response, across all tables. */
  count: number;
}
