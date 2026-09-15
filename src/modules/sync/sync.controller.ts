import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserId } from '../../common/decorators/current-user.decorator';
import { SyncPullQueryDto, SyncPushDto } from './sync.dto';
import { SyncService } from './sync.service';

@ApiTags('Sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('pull')
  @ApiOperation({
    summary: 'Rows changed server-side since the client cursor',
    description:
      'Returns rows grouped by table, plus the cursor to send next time. ' +
      'Soft-deleted rows are included — a tombstone is the only way a client ' +
      'learns that a row it holds is gone.',
  })
  pull(@UserId() userId: string, @Query() query: SyncPullQueryDto) {
    const since = parseCursor(query.since);
    return this.sync.pull(userId, since, query.limit ?? 500, query.deviceId);
  }

  @Post('push')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply a batch of client changes',
    description:
      'Last writer wins per row, compared on `updatedAt`, server wins ties. ' +
      'Rejected changes come back in `conflicts` with the server timestamp ' +
      'that beat them; the client should pull and re-apply those rows.',
  })
  push(@UserId() userId: string, @Body() dto: SyncPushDto) {
    return this.sync.push(userId, dto);
  }

  @Get('status')
  @ApiOperation({
    summary:
      'Current cursor, syncable tables, and how far each device is behind',
  })
  status(@UserId() userId: string) {
    return this.sync.status(userId);
  }
}

/** Cursors travel as decimal strings; anything unparseable starts from zero. */
function parseCursor(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    const parsed = BigInt(value);
    return parsed < 0n ? 0n : parsed;
  } catch {
    return 0n;
  }
}
