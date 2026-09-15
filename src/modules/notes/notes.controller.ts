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
import { CreateNoteDto, NoteQueryDto, UpdateNoteDto } from './notes.dto';
import { NotesService } from './notes.service';

@ApiTags('Notes')
@ApiBearerAuth()
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @ApiOperation({ summary: 'List notes' })
  list(@UserId() userId: string, @Query() query: NoteQueryDto) {
    return this.notes.find(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a note' })
  create(@UserId() userId: string, @Body() dto: CreateNoteDto) {
    return this.notes.createNote(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one note' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a note' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notes.updateNote(userId, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a note' })
  archive(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.archive(userId, id);
  }

  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unarchive a note' })
  unarchive(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.unarchive(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a note' })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.remove(userId, id);
  }
}
