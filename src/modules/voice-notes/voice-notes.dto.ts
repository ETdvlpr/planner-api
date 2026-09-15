import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CreateVoiceNoteDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ example: 'voice-2026-09-10.m4a' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 'audio/mp4' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 482_301 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @ApiPropertyOptional({ example: 42_000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationMs?: number;

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
}

export class UpdateVoiceNoteDto extends PartialType(CreateVoiceNoteDto) {}

export class VoiceNoteQueryDto extends PaginationQueryDto {
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
}
