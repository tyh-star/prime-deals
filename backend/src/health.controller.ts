import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from './common/auth.decorators';
import { REDIS } from './redis/redis.module';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check() {
    const [db, cache] = await Promise.all([
      this.dataSource
        .query('SELECT 1')
        .then(() => 'up')
        .catch(() => 'down'),
      this.redis
        .ping()
        .then(() => 'up')
        .catch(() => 'down'),
    ]);
    const body = { status: db === 'up' && cache === 'up' ? 'ok' : 'degraded', db, redis: cache };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
