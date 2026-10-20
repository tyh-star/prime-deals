import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { setupApp } from './setup-app';

async function bootstrap() {
  // Local development convenience; in containers the environment is injected directly.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  setupApp(app);
  const cfg = app.get<AppConfig>(APP_CONFIG);
  await app.listen(cfg.port, '0.0.0.0');
  Logger.log(`API listening on :${cfg.port} — docs at /api/docs`, 'Bootstrap');
}

void bootstrap();
