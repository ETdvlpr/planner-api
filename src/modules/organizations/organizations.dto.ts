import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { OrgStatus } from '@prisma/client';
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

export class CreateOrganizationDto {
  @ApiPropertyOptional({
    description:
      'Client-generated UUID. Supply it when the row already exists on a ' +
      'device, so the same row is not created twice.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Infnova' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: OrgStatus, default: OrgStatus.active })
  @IsOptional()
  @IsEnum(OrgStatus)
  status?: OrgStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional({ description: 'Material icon code point' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  iconCodePoint?: number;

  @ApiPropertyOptional({ description: '32-bit ARGB colour' })
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

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {}

export class OrganizationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrgStatus })
  @IsOptional()
  @IsEnum(OrgStatus)
  status?: OrgStatus;

  @ApiPropertyOptional({
    description: 'Free-text match on name and description',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
