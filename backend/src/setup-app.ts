import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppConfig, APP_CONFIG } from './config/app-config';
import { ImageStorageService, UPLOAD_URL_PREFIX } from './products/image-storage.service';

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export function setupApp(app: NestExpressApplication): void {
  const cfg = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({
    origin: cfg.corsOrigin,
    exposedHeaders: ['Idempotent-Replayed'],
  });
  app.useStaticAssets(app.get(ImageStorageService).dir, {
    prefix: UPLOAD_URL_PREFIX,
    maxAge: '7d',
    immutable: true,
  });
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('Prime Deals API')
    .setDescription('Catalogue, cart and orders with oversell protection and idempotent checkout')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
}
