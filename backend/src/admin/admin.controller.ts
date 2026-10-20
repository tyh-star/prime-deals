import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { PaginationQuery } from '../common/pagination.dto';
import { OrderQuery } from '../orders/order.dto';
import { OrdersService } from '../orders/orders.service';
import { AdminProductQuery, RejectProductDto } from '../products/product.dto';
import { ProductsService } from '../products/products.service';
import { Role } from '../users/user.entity';
import { UsersService } from '../users/users.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly products: ProductsService,
    private readonly users: UsersService,
    private readonly orders: OrdersService,
  ) {}

  /** Review queue; defaults to all statuses, oldest submission first. */
  @Get('products')
  listProducts(@Query() query: AdminProductQuery) {
    return this.products.listForReview(query.status, query.page, query.pageSize);
  }

  @Post('products/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() admin: AuthUser) {
    return this.products.approve(id, admin.id);
  }

  @Post('products/:id/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() admin: AuthUser,
    @Body() dto: RejectProductDto,
  ) {
    return this.products.reject(id, admin.id, dto.reason);
  }

  @Get('users')
  listUsers(@Query() query: PaginationQuery) {
    return this.users.list(query.page, query.pageSize);
  }

  @Get('orders')
  async listOrders(@CurrentUser() admin: AuthUser, @Query() query: OrderQuery) {
    const page = await this.orders.listAll(query.status, query.page, query.pageSize);
    return { ...page, items: page.items.map((o) => this.orders.present(o, admin)) };
  }
}
