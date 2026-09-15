import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/**
 * The principal the auth guard attaches. Declared here rather than cast at each
 * use site so that reading it wrong is a compile error.
 */
declare global {
  namespace Express {
    interface Request {
      plannerUser?: AuthenticatedUser;
    }
  }
}

export {};
