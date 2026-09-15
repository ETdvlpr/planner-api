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
  CreateDecisionDto,
  DecisionQueryDto,
  UpdateDecisionDto,
} from './decisions.dto';
import { DecisionsService } from './decisions.service';

@ApiTags('Decisions')
@ApiBearerAuth()
@Controller('decisions')
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Get()
  @ApiOperation({ summary: 'List decisions' })
  list(@UserId() userId: string, @Query() query: DecisionQueryDto) {
    return this.decisions.find(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Record a decision' })
  create(@UserId() userId: string, @Body() dto: CreateDecisionDto) {
    return this.decisions.createDecision(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one decision' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.decisions.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a decision' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDecisionDto,
  ) {
    return this.decisions.updateDecision(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a decision' })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.decisions.remove(userId, id);
  }
}
