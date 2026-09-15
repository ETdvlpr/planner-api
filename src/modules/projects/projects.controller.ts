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
  CreateProjectDto,
  ProjectQueryDto,
  UpdateProjectDto,
} from './projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List projects' })
  list(@UserId() userId: string, @Query() query: ProjectQueryDto) {
    return this.projects.find(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a project' })
  create(@UserId() userId: string, @Body() dto: CreateProjectDto) {
    return this.projects.createProject(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one project' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.updateProject(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a project' })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.remove(userId, id);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Undo a soft delete' })
  restore(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.restore(userId, id);
  }
}
