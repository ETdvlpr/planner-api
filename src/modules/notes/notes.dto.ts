import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CreateNoteDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  body: string;

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
  requirementId?: string;
}

export class UpdateNoteDto extends PartialType(CreateNoteDto) {}

export class NoteQueryDto extends PaginationQueryDto {
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
  requirementId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;
}
