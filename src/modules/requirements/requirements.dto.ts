import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { RequirementStatus, RequirementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CreateRequirementDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Export a project as markdown' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: RequirementType,
    default: RequirementType.requirement,
  })
  @IsOptional()
  @IsEnum(RequirementType)
  type?: RequirementType;

  @ApiPropertyOptional({
    enum: RequirementStatus,
    default: RequirementStatus.unreviewed,
  })
  @IsOptional()
  @IsEnum(RequirementStatus)
  status?: RequirementStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'The meeting this came out of' })
  @IsOptional()
  @IsUUID()
  sourceMeetingId?: string;

  @ApiPropertyOptional({ description: 'The specific note line this came from' })
  @IsOptional()
  @IsUUID()
  sourceNoteItemId?: string;
}

export class UpdateRequirementDto extends PartialType(CreateRequirementDto) {}

export class RequirementQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RequirementStatus })
  @IsOptional()
  @IsEnum(RequirementStatus)
  status?: RequirementStatus;

  @ApiPropertyOptional({ enum: RequirementType })
  @IsOptional()
  @IsEnum(RequirementType)
  type?: RequirementType;

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
  sourceMeetingId?: string;

  @ApiPropertyOptional({ description: 'Unreviewed, accepted or planned only' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  openOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;
}
