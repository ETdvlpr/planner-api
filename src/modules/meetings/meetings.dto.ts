import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ProcessedItemKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CreateMeetingDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Weekly sync — Infnova' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @ApiProperty()
  @IsDateString()
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Free text; not a contact list' })
  @IsOptional()
  @IsString()
  attendees?: string;

  @ApiPropertyOptional({
    description:
      'The untouched capture. Processing never rewrites this field — it is ' +
      'the source of truth that note items are derived from.',
  })
  @IsOptional()
  @IsString()
  rawNotes?: string;
}

export class UpdateMeetingDto extends PartialType(CreateMeetingDto) {}

export class MeetingQueryDto extends PaginationQueryDto {
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
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;
}

export class CreateNoteItemDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Ask finance about the Q3 invoice' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;
}

export class UpdateNoteItemDto extends PartialType(CreateNoteItemDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  processed?: boolean;
}

export class MarkProcessedDto {
  @ApiProperty({ enum: ProcessedItemKind })
  @IsEnum(ProcessedItemKind)
  resultKind: ProcessedItemKind;

  @ApiPropertyOptional({
    description: 'The row the note line turned into, when it produced one',
  })
  @IsOptional()
  @IsUUID()
  resultId?: string;
}

/** Splits raw notes into note items in one call — the "process" button. */
export class SplitNotesDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Replace existing note items. Off by default: re-splitting after ' +
      'processing would discard which lines were already dealt with.',
  })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}
