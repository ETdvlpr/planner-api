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
  ConfirmUploadDto,
  RequestUploadDto,
} from '../attachments/attachments.dto';
import {
  CreateVoiceNoteDto,
  UpdateVoiceNoteDto,
  VoiceNoteQueryDto,
} from './voice-notes.dto';
import { VoiceNotesService } from './voice-notes.service';

@ApiTags('Voice notes')
@ApiBearerAuth()
@Controller('voice-notes')
export class VoiceNotesController {
  constructor(private readonly voiceNotes: VoiceNotesService) {}

  @Get()
  @ApiOperation({ summary: 'List voice notes' })
  list(@UserId() userId: string, @Query() query: VoiceNoteQueryDto) {
    return this.voiceNotes.find(userId, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a voice note and get a presigned upload URL',
  })
  create(@UserId() userId: string, @Body() dto: CreateVoiceNoteDto) {
    return this.voiceNotes.createWithUpload(userId, dto);
  }

  @Post(':id/upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A presigned upload URL for a voice note that already exists',
    description:
      'For rows that arrived through `/sync/push` before their bytes could ' +
      'be sent. PUT the file, then call `POST /voice-notes/:id/confirm`.',
  })
  requestUpload(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestUploadDto,
  ) {
    return this.voiceNotes.requestUpload(userId, id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the upload landed' })
  confirm(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmUploadDto,
  ) {
    return this.voiceNotes.confirmUpload(userId, id, dto.objectKey);
  }

  @Get(':id/url')
  @ApiOperation({ summary: 'A short-lived URL for playing the recording' })
  url(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.voiceNotes.downloadUrl(userId, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one voice note' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.voiceNotes.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update voice-note metadata' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVoiceNoteDto,
  ) {
    return this.voiceNotes.updateVoiceNote(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a voice note' })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.voiceNotes.remove(userId, id);
  }
}
