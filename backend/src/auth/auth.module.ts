import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { TokenDenylistService } from './token-denylist.service';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        secret: cfg.jwtSecret,
        signOptions: { expiresIn: cfg.jwtExpiresInSeconds },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenDenylistService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
