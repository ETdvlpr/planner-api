import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { FirebaseAdminService } from '../../modules/auth/firebase-admin.service';
import { isAnonymous } from '../../modules/auth/claims';
import { UsersService } from '../../modules/users/users.service';

/**
 * The one place a caller's identity is established.
 *
 * Registered globally, so a route is authenticated unless it opts out with
 * `@Public()`. That default is the point: the rule that the API never accepts
 * an owner id from the client only holds if every handler is scoped by a
 * principal this guard produced.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(FirebaseAuthGuard.name);

  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly users: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException('No ID token provided');

    let claims;
    try {
      claims = await this.firebase.verifyIdToken(token);
    } catch (error) {
      this.logger.debug(
        `Token verification failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      throw new UnauthorizedException('Invalid or expired ID token');
    }

    request.plannerUser = await this.users.resolvePrincipal({
      uid: claims.uid,
      email: claims.email,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      picture: claims.picture,
      anonymous: isAnonymous(claims),
    });

    return true;
  }
}

function extractBearerToken(request: Request): string | undefined {
  const [type, token] = request.headers.authorization?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
}
