import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '../users/user.entity';

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  /** JWT id, used to revoke the token on logout. */
  jti: string;
  /** Token expiry (seconds since epoch). */
  exp: number;
}

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Route needs no token. If a valid token is sent anyway, `req.user` is still populated. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route to the listed roles (requires authentication). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest().user,
);
