import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AttachmentKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CreateAttachmentDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ enum: AttachmentKind })
  @IsEnum(AttachmentKind)
  kind: AttachmentKind;

  @ApiProperty({ example: 'screenshot-2026-09-10.png' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 184_320 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  meetingId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  noteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requirementId?: string;
}

export class UpdateAttachmentDto extends PartialType(CreateAttachmentDto) {}

/**
 * Asks for a presigned URL for a row that already exists — the mobile path.
 *
 * A phone creates the attachment row offline and replicates it through
 * `/sync/push`; by the time it has a network, the row is on the server and
 * `POST /attachments` would collide on the id. The file's name, type and size
 * come from the client because they describe the bytes it is about to send,
 * and the size is signed into the URL.
 */
export class RequestUploadDto {
  @ApiProperty({ example: 'a1b2c3.jpg' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 184_320 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;
}

export class ConfirmUploadDto {
  @ApiProperty({
    description: 'The key returned when the upload was requested',
  })
  @IsString()
  @IsNotEmpty()
  objectKey: string;
}

export class AttachmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AttachmentKind })
  @IsOptional()
  @IsEnum(AttachmentKind)
  kind?: AttachmentKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  meetingId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  noteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requirementId?: string;
}
