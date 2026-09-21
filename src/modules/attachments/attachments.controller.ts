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
import {
  CurrentUser,
  UserId,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import {
  AttachmentQueryDto,
  ConfirmUploadDto,
  CreateAttachmentDto,
  RequestUploadDto,
  UpdateAttachmentDto,
} from './attachments.dto';
import { AttachmentsService } from './attachments.service';

@ApiTags('Attachments')
@ApiBearerAuth()
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List attachments' })
  list(@UserId() userId: string, @Query() query: AttachmentQueryDto) {
    return this.attachments.find(userId, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an attachment row and get a presigned upload URL',
    description:
      'Bytes go straight to R2 — this API never handles them. PUT the file to ' +
      '`upload.uploadUrl` with the headers given, then call ' +
      '`POST /attachments/:id/confirm`.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAttachmentDto,
  ) {
    return this.attachments.createWithUpload(user.id, dto, {
      isAnonymous: user.isAnonymous,
    });
  }

  @Post(':id/upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A presigned upload URL for an attachment that already exists',
    description:
      'For rows that arrived through `/sync/push` before their bytes could ' +
      'be sent. PUT the file to `upload.uploadUrl` with the headers given, ' +
      'then call `POST /attachments/:id/confirm`.',
  })
  requestUpload(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestUploadDto,
  ) {
    return this.attachments.requestUpload(userId, id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the upload landed' })
  confirm(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmUploadDto,
  ) {
    return this.attachments.confirmUpload(userId, id, dto.objectKey);
  }

  @Get(':id/url')
  @ApiOperation({ summary: 'A short-lived URL for viewing the file' })
  url(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.downloadUrl(userId, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one attachment' })
  findOne(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update attachment metadata' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttachmentDto,
  ) {
    return this.attachments.updateAttachment(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete an attachment',
    description: 'The R2 object is left in place; a separate job reaps it.',
  })
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.removeAttachment(userId, id);
  }
}
