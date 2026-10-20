import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    UsersModule,
    AuthModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
