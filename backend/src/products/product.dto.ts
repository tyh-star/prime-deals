import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { PaginationQuery } from '../common/pagination.dto';
import { ProductStatus } from './product.entity';

const PRICE_MESSAGE = 'price must be a positive amount with at most 2 decimals, e.g. "19.99"';

/** Sent as multipart/form-data together with up to 5 `images` files. */
export class CreateProductDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** Decimal string, converted to integer cents server-side. */
  @IsString()
  @Matches(/^\d{1,7}(\.\d{1,2})?$/, { message: PRICE_MESSAGE })
  price: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;
}

/**
 * Editing listing content sends the product back to review. Stock is deliberately
 * not editable here — use the relative stock adjustment endpoint, which cannot
 * overwrite concurrent order deductions.
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,7}(\.\d{1,2})?$/, { message: PRICE_MESSAGE })
  price?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;
}

export class AdjustStockDto {
  /** Positive to restock, negative to remove units. */
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  @Min(-1_000_000)
  @Max(1_000_000)
  delta: number;
}

export class RejectProductDto {
  @IsString()
  @Length(1, 500)
  reason: string;
}

export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export class ProductQuery extends PaginationQuery {
  /** Matches name or category, case-insensitive. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;
}

export class AdminProductQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(Object.values(ProductStatus))
  status?: ProductStatus;
}
