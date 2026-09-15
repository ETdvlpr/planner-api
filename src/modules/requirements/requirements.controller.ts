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
  CreateRequirementDto,
  RequirementQueryDto,
  UpdateRequirementDto,
} from './requirements.dto';
import { RequirementsService } from './requirements.service';

@ApiTags('Requirements')
@ApiBearerAuth()
@Controller('requirements')
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}

  @Get()
  @ApiOperation({ summary: 'List requirements, features, ideas and questions' })
  list(@UserId() userId: string, @Query() query: RequirementQueryDto) {
    return this.requirements.find(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a requirement' })
  create(@UserId() userId: string, @Body() dto: CreateRequirementDto) {
    return this.requirements.createRequirement(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one requirement' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.requirements.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a requirement' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.requirements.updateRequirement(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a requirement' })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.requirements.remove(userId, id);
  }
}
