import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, description: '1-based page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;

  @ApiPropertyOptional({
    default: false,
    description:
      'Include soft-deleted rows. Only sync and diagnostics need this; the ' +
      'UI never should.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeDeleted: boolean = false;
}
