import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/product.entity';
import { CartController } from './cart.controller';
import { CartItem } from './cart-item.entity';
import { CartService } from './cart.service';

@Module({
  imports: [TypeOrmModule.forFeature([CartItem, Product])],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
