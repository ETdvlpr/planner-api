import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import {
  CurrentUser,
  UserId,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'David Samuel' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsOptional()
  @IsUrl()
  photoUrl?: string;
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary:
      'The signed-in user. Creates the Planner account on first call — there ' +
      'is no separate registration endpoint; Firebase already ran the sign-up.',
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the signed-in user profile' })
  updateMe(@UserId() userId: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(userId, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Erase the account. Deletes the Firebase user first, then every row ' +
      'this account owns. Irreversible, and required for GDPR.',
  })
  deleteMe(@UserId() userId: string) {
    return this.users.deleteAccount(userId);
  }
}
