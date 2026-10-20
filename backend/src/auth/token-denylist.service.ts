import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/**
 * Revoked JWT ids, stored in Redis only until the token would have expired anyway.
 */
@Injectable()
export class TokenDenylistService {
  private readonly logger = new Logger(TokenDenylistService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async revoke(jti: string, expSeconds: number): Promise<void> {
    const ttl = expSeconds - Math.floor(Date.now() / 1000);
    if (ttl > 0) await this.redis.set(`auth:revoked:${jti}`, '1', 'EX', ttl);
  }

  async isRevoked(jti: string): Promise<boolean> {
    try {
      return (await this.redis.exists(`auth:revoked:${jti}`)) === 1;
    } catch (err) {
      // Fail open: a Redis outage should not lock every user out. Tokens are short-lived.
      this.logger.warn(`Denylist check skipped: ${(err as Error).message}`);
      return false;
    }
  }
}
