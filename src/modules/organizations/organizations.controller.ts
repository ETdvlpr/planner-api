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
  CreateOrganizationDto,
  OrganizationQueryDto,
  UpdateOrganizationDto,
} from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'List organizations' })
  list(@UserId() userId: string, @Query() query: OrganizationQueryDto) {
    return this.organizations.find(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create an organization' })
  create(@UserId() userId: string, @Body() dto: CreateOrganizationDto) {
    return this.organizations.createOrganization(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one organization' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizations.findOne(userId, id);
  }

  @Get(':id/summary')
  @ApiOperation({ summary: 'Organization with its open-work counts' })
  summary(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizations.summary(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an organization' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizations.updateOrganization(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete an organization',
    description:
      'The row is tombstoned, not removed — peers learn about the deletion on ' +
      'their next pull. Projects and tasks that referenced it keep their ' +
      '`organizationId`; the client resolves a deleted parent to the Inbox.',
  })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizations.remove(userId, id);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Undo a soft delete' })
  restore(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizations.restore(userId, id);
  }
}
