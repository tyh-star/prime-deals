import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { CartService, MAX_CART_QUANTITY } from './cart.service';

export class AddCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CART_QUANTITY)
  quantity: number = 1;
}

export class SetQuantityDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CART_QUANTITY)
  quantity: number;
}

@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  view(@CurrentUser() user: AuthUser) {
    return this.cart.view(user.id);
  }

  @Post('items')
  @HttpCode(200)
  add(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto) {
    return this.cart.add(user.id, dto.productId, dto.quantity);
  }

  @Patch('items/:productId')
  setQuantity(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: SetQuantityDto,
  ) {
    return this.cart.setQuantity(user.id, productId, dto.quantity);
  }

  @Delete('items/:productId')
  remove(@CurrentUser() user: AuthUser, @Param('productId', ParseIntPipe) productId: number) {
    return this.cart.remove(user.id, productId);
  }

  @Delete()
  @HttpCode(204)
  async clear(@CurrentUser() user: AuthUser) {
    await this.cart.clear(user.id);
  }
}
