import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthUser, IS_PUBLIC, ROLES } from '../common/auth.decorators';
import { Role } from '../users/user.entity';
import { TokenDenylistService } from './token-denylist.service';

interface JwtPayload {
  sub: number;
  username: string;
  role: Role;
  jti: string;
  exp: number;
}

/**
 * Global guard: every route requires a valid bearer token unless marked @Public(),
 * and @Roles(...) further restricts by role.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly denylist: TokenDenylistService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    const user = await this.authenticate(req, isPublic);
    if (user) req.user = user;

    if (isPublic) return true;
    if (!user) throw new UnauthorizedException('Login required');
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
    }
    return true;
  }

  private async authenticate(req: Request, optional: boolean): Promise<AuthUser | undefined> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return undefined;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(header.slice(7));
      if (await this.denylist.isRevoked(payload.jti)) throw new Error('revoked');
      return {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        jti: payload.jti,
        exp: payload.exp,
      };
    } catch {
      if (optional) return undefined;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
