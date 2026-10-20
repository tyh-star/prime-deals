import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from '../orders/orders.module';
import { Product } from '../products/product.entity';
import { ProductsModule } from '../products/products.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { BootstrapService } from './bootstrap.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product]), ProductsModule, UsersModule, OrdersModule],
  controllers: [AdminController],
  providers: [BootstrapService],
})
export class AdminModule {}
