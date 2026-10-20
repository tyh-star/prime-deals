import { HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { AuthUser } from '../common/auth.decorators';
import { REDIS } from '../redis/redis.module';
import { Role, User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { TokenDenylistService } from './token-denylist.service';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_SECONDS = 15 * 60;

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly denylist: TokenDenylistService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const user = await this.users.create({
      username: dto.username,
      password: dto.password,
      phone: dto.phone,
      role: dto.role ?? Role.BUYER,
    });
    return this.issue(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const failKey = `auth:fail:${dto.username.toLowerCase()}`;
    const failures = Number((await this.safe(() => this.redis.get(failKey))) ?? 0);
    if (failures >= MAX_FAILED_LOGINS) {
      throw new HttpException(
        { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed attempts, try again in 15 minutes' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.findWithPassword(dto.username);
    const ok = user ? await this.users.verifyPassword(user, dto.password) : false;
    if (!user || !ok) {
      await this.safe(() =>
        this.redis.multi().incr(failKey).expire(failKey, LOCKOUT_SECONDS).exec(),
      );
      // Same message for unknown user and wrong password: don't leak which usernames exist.
      throw new UnauthorizedException({ code: 'BAD_CREDENTIALS', message: 'Wrong username or password' });
    }

    await this.safe(() => this.redis.del(failKey));
    const { passwordHash: _omit, ...publicUser } = user;
    return this.issue(publicUser as User);
  }

  async logout(user: AuthUser): Promise<void> {
    await this.denylist.revoke(user.jti, user.exp);
  }

  private async issue(user: User): Promise<AuthResponse> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role },
      { jwtid: randomUUID() },
    );
    const decoded = this.jwt.decode<{ exp: number; iat: number }>(accessToken);
    return { accessToken, expiresIn: decoded.exp - decoded.iat, user };
  }

  /** Login throttling is best-effort; a Redis outage must not block logins. */
  private async safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`Redis unavailable for login throttling: ${(err as Error).message}`);
      return undefined;
    }
  }
}
