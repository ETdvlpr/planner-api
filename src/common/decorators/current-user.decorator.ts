import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * The authenticated principal, assembled by {@link FirebaseAuthGuard}.
 *
 * `id` is the Planner user id — the one every `user_id` column references.
 * `firebaseUid` is kept for the account-deletion path and for logs; nothing in
 * the domain is ever scoped by it.
 */
export interface AuthenticatedUser {
  id: string;
  firebaseUid: string;
  email: string | null;
  /**
   * A guest — the token's `sign_in_provider` is `anonymous`. Read from the
   * claims on every request, never from the cache, so linking the account to a
   * real sign-in lifts guest limits on the very next call.
   */
  isAnonymous: boolean;
}

export const REQUEST_USER_KEY = 'plannerUser';

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.plannerUser;
    return data ? user?.[data] : user;
  },
);

/**
 * Shorthand for the common case: a handler that only needs the owner id to
 * scope its query.
 */
export const UserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    // Non-null: the global guard rejects the request before any handler runs.
    return request.plannerUser!.id;
  },
);
