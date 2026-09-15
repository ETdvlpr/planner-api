import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserId } from '../../common/decorators/current-user.decorator';
import {
  CompleteTaskDto,
  CreateChecklistItemDto,
  CreateTaskDto,
  TaskQueryDto,
  UpdateChecklistItemDto,
  UpdateTaskDto,
} from './tasks.dto';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'List tasks' })
  list(@UserId() userId: string, @Query() query: TaskQueryDto) {
    return this.tasks.find(userId, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a task',
    description:
      'Only `title` is required. Everything else — organization, project, ' +
      'deadline — is optional, and an untyped capture lands in the Inbox.',
  })
  create(@UserId() userId: string, @Body() dto: CreateTaskDto) {
    return this.tasks.createTask(userId, dto);
  }

  @Get('series/:recurringSeriesId')
  @ApiOperation({
    summary: 'Every occurrence of one recurring obligation, newest first',
  })
  series(
    @UserId() userId: string,
    @Param('recurringSeriesId', ParseUUIDPipe) seriesId: string,
  ) {
    return this.tasks.seriesHistory(userId, seriesId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one task' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.updateTask(userId, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a task',
    description:
      'Writes an Activity entry that outlives the task, and — for a recurring ' +
      'task — creates the next occurrence as a new row sharing the series id. ' +
      'The response carries both.',
  })
  complete(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteTaskDto,
  ) {
    return this.tasks.complete(
      userId,
      id,
      dto.completedAt ? new Date(dto.completedAt) : undefined,
    );
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a completed task' })
  reopen(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.reopen(userId, id);
  }

  @Post(':id/drop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abandon a task without completing it' })
  drop(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.drop(userId, id);
  }

  @Post(':id/carry-forward')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Defer a task in the weekly review' })
  carryForward(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasks.carryForward(userId, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete a task',
    description:
      'Checklist items go with it. Activity entries do not — their `taskId` ' +
      'is cleared so the record of the work survives.',
  })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.removeTask(userId, id);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Undo a soft delete' })
  restore(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.restore(userId, id);
  }

  // ────────────────────────────────────────────────────────────── checklist

  @Get(':id/checklist')
  @ApiOperation({ summary: 'Checklist items for a task' })
  checklist(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.checklist(userId, id);
  }

  @Post(':id/checklist')
  @ApiOperation({ summary: 'Add a checklist item' })
  addChecklistItem(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChecklistItemDto,
  ) {
    return this.tasks.addChecklistItem(userId, id, dto);
  }

  @Patch('checklist/:itemId')
  @ApiOperation({ summary: 'Update a checklist item' })
  updateChecklistItem(
    @UserId() userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.tasks.updateChecklistItem(userId, itemId, dto);
  }

  @Delete('checklist/:itemId')
  @ApiOperation({ summary: 'Remove a checklist item' })
  removeChecklistItem(
    @UserId() userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.tasks.removeChecklistItem(userId, itemId);
  }
}
