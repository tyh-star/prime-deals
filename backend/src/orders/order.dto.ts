import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../common/pagination.dto';
import { OrderStatus } from './order-state-machine';

export const MAX_ORDER_LINES = 20;
export const MAX_LINE_QUANTITY = 99;

export class OrderLineDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items: OrderLineDto[];

  /** Remove the purchased products from the buyer's cart in the same transaction. */
  @IsOptional()
  @IsBoolean()
  clearCartItems?: boolean;
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class OrderQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;
}
