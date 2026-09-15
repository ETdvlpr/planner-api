import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserId } from '../../common/decorators/current-user.decorator';
import {
  ActivityQueryDto,
  LogActivityDto,
  ReviewQueryDto,
  UpdateActivityDto,
} from './activity.dto';
import { ActivityService } from './activity.service';

@ApiTags('Activity')
@ApiBearerAuth()
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @ApiOperation({ summary: 'The record of what actually happened' })
  list(@UserId() userId: string, @Query() query: ActivityQueryDto) {
    return this.activity.find(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Log something that was done, after the fact' })
  log(@UserId() userId: string, @Body() dto: LogActivityDto) {
    return this.activity.log(userId, dto);
  }

  @Get('review')
  @ApiOperation({
    summary: 'Weekly review — planned and unplanned work side by side',
  })
  review(@UserId() userId: string, @Query() query: ReviewQueryDto) {
    return this.activity.review(
      userId,
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one activity entry' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.activity.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an activity entry' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activity.updateActivity(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete an activity entry' })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.activity.remove(userId, id);
  }
}
