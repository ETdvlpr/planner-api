import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ActivitySource } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class LogActivityDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    example: 'Rebuilt the staging database from the nightly dump',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({
    enum: ActivitySource,
    default: ActivitySource.manual,
    description:
      'Defaults to `manual` — work that never existed as a task first. That ' +
      'is the whole point of this endpoint.',
  })
  @IsOptional()
  @IsEnum(ActivitySource)
  source?: ActivitySource;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

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
}

export class UpdateActivityDto extends PartialType(LogActivityDto) {}

export class ActivityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ActivitySource })
  @IsOptional()
  @IsEnum(ActivitySource)
  source?: ActivitySource;

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

export class ReviewQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to seven days ago' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
