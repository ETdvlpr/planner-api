import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  DeadlinePrecision,
  RecurrenceFrequency,
  TaskContextTag,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class RecurrenceSpecDto {
  @ApiProperty({ enum: RecurrenceFrequency })
  @IsEnum(RecurrenceFrequency)
  frequency: RecurrenceFrequency;

  @ApiPropertyOptional({ default: 1, description: 'The N in "every N weeks"' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  interval?: number;

  @ApiPropertyOptional({
    description: 'Weekday bitmask, Monday = 1 << 0 … Sunday = 1 << 6',
    minimum: 0,
    maximum: 127,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(127)
  weekdaysMask?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  monthOfYear?: number;

  @ApiPropertyOptional({ description: 'Days before the deadline to remind' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reminderDaysBefore?: number;

  @ApiPropertyOptional({ description: 'Minutes from midnight', maximum: 1439 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1439)
  reminderMinuteOfDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CreateTaskDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'File Q3 VAT return' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: TaskType, default: TaskType.projectWork })
  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  @ApiPropertyOptional({
    enum: TaskStatus,
    default: TaskStatus.inbox,
    description: 'Capture first, organize later — the default is the Inbox.',
  })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.p2 })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ enum: TaskContextTag })
  @IsOptional()
  @IsEnum(TaskContextTag)
  context?: TaskContextTag;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceRequirementId?: string;

  @ApiPropertyOptional({ description: 'One level of subtasks only' })
  @IsOptional()
  @IsUUID()
  parentTaskId?: string;

  @ApiPropertyOptional({
    description: 'Who or what a Waiting item is blocked on',
  })
  @IsOptional()
  @IsString()
  waitingOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({
    enum: DeadlinePrecision,
    default: DeadlinePrecision.day,
    description:
      'A `week` deadline is the last day of its week and means "sometime ' +
      'that week". Reset to `day` whenever the deadline is cleared.',
  })
  @IsOptional()
  @IsEnum(DeadlinePrecision)
  deadlinePrecision?: DeadlinePrecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reminderAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({
    type: RecurrenceSpecDto,
    description:
      'Makes this the first occurrence of a series. The rule is stored once ' +
      'and every occurrence points at it.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceSpecDto)
  recurrence?: RecurrenceSpecDto;
}

export class UpdateTaskDto extends PartialType(CreateTaskDto) {}

export class TaskQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TaskStatus, isArray: true })
  @IsOptional()
  // A single `?status=next` arrives as a string, not an array, and would
  // otherwise fail the `each` check. Coerce so one value works like many.
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || Array.isArray(value) ? value : [value],
  )
  @IsEnum(TaskStatus, { each: true })
  status?: TaskStatus[];

  @ApiPropertyOptional({ enum: TaskType })
  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ enum: TaskContextTag })
  @IsOptional()
  @IsEnum(TaskContextTag)
  context?: TaskContextTag;

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
  parentTaskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  recurringSeriesId?: string;

  @ApiPropertyOptional({
    description: 'Only tasks with no project and no organization',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  inbox?: boolean;

  @ApiPropertyOptional({
    description: 'Open work only: next, inProgress, waiting',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  openOnly?: boolean;

  @ApiPropertyOptional({ description: 'Deadline on or before this date' })
  @IsOptional()
  @IsDateString()
  dueBefore?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;
}

export class CompleteTaskDto {
  @ApiPropertyOptional({
    description:
      'When the work was actually finished. Supplied by a client that ' +
      'completed the task offline; defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}

export class CreateChecklistItemDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Download the bank statement' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;
}

export class UpdateChecklistItemDto extends PartialType(
  CreateChecklistItemDto,
) {}
