import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        new Redis(cfg.redisUrl, {
          // Fail individual commands quickly instead of queueing forever when Redis is down;
          // callers that can degrade (idempotency, token denylist) catch and fall back.
          maxRetriesPerRequest: 2,
          enableOfflineQueue: true,
        }),
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
