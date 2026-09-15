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
  CreateMeetingDto,
  CreateNoteItemDto,
  MarkProcessedDto,
  MeetingQueryDto,
  SplitNotesDto,
  UpdateMeetingDto,
  UpdateNoteItemDto,
} from './meetings.dto';
import { MeetingsService } from './meetings.service';

@ApiTags('Meetings')
@ApiBearerAuth()
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  @ApiOperation({ summary: 'List meetings' })
  list(@UserId() userId: string, @Query() query: MeetingQueryDto) {
    return this.meetings.find(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a meeting' })
  create(@UserId() userId: string, @Body() dto: CreateMeetingDto) {
    return this.meetings.createMeeting(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one meeting' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a meeting' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.meetings.updateMeeting(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a meeting' })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.remove(userId, id);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'How much of this meeting has been processed' })
  status(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.processingStatus(userId, id);
  }

  // ─────────────────────────────────────────────────────────────── note items

  @Get(':id/note-items')
  @ApiOperation({ summary: 'Note items derived from this meeting' })
  noteItems(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.noteItems(userId, id);
  }

  @Post(':id/note-items')
  @ApiOperation({ summary: 'Add a note item' })
  addNoteItem(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteItemDto,
  ) {
    return this.meetings.addNoteItem(userId, id, dto);
  }

  @Post(':id/split')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Derive note items from the raw notes, one per non-empty line',
  })
  split(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SplitNotesDto,
  ) {
    return this.meetings.splitRawNotes(userId, id, dto.replace ?? false);
  }

  @Patch('note-items/:itemId')
  @ApiOperation({ summary: 'Update a note item' })
  updateNoteItem(
    @UserId() userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateNoteItemDto,
  ) {
    return this.meetings.updateNoteItem(userId, itemId, dto);
  }

  @Post('note-items/:itemId/processed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record what a note line turned into' })
  markProcessed(
    @UserId() userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: MarkProcessedDto,
  ) {
    return this.meetings.markProcessed(userId, itemId, dto);
  }

  @Delete('note-items/:itemId')
  @ApiOperation({ summary: 'Remove a note item' })
  removeNoteItem(
    @UserId() userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.meetings.removeNoteItem(userId, itemId);
  }
}
