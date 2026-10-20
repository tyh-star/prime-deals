import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyService } from './idempotency.service';
import { Order, OrderItem, OrderStatusLog } from './order.entity';
import { OrderTimeoutQueue } from './order-timeout.queue';
import { OrderTimeoutWorker } from './order-timeout.worker';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem, OrderStatusLog])],
  controllers: [OrdersController],
  providers: [OrdersService, IdempotencyService, OrderTimeoutQueue, OrderTimeoutWorker],
  exports: [OrdersService, OrderTimeoutWorker],
})
export class OrdersModule {}
