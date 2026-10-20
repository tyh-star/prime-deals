import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { dataSourceOptions } from './data-source';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        ...dataSourceOptions(cfg.databaseUrl),
        // Apply pending migrations on boot so `docker compose up` is a one-step start.
        migrationsRun: true,
        logging: cfg.nodeEnv === 'development' ? ['error', 'warn', 'migration'] : ['error'],
      }),
    }),
  ],
})
export class DatabaseModule {}
