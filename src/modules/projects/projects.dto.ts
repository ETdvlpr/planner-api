import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ProjectStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CreateProjectDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({
    description:
      'Optional at every level — a project with no organization is valid, ' +
      'and so is a task with neither.',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiProperty({ example: 'Planner backend' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ProjectStatus, default: ProjectStatus.active })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  iconCodePoint?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  colorValue?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}

export class ProjectQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Only projects with no organization' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unassigned?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;
}
