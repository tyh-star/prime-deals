import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { Role } from '../users/user.entity';
import { CancelOrderDto, CreateOrderDto, OrderQuery } from './order.dto';
import { OrderEvent } from './order-state-machine';
import { OrdersService } from './orders.service';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique per checkout attempt (e.g. a UUID). Retries must reuse it.',
  })
  @Post()
  @HttpCode(201)
  async place(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Send an Idempotency-Key header: 8–128 characters of letters, digits, _ or -',
      });
    }
    const { order, replayed } = await this.orders.place(user, key, dto);
    if (replayed) {
      res.status(200);
      res.setHeader('Idempotent-Replayed', 'true');
    }
    return this.orders.present(order, user);
  }

  @Get()
  async mine(@CurrentUser() user: AuthUser, @Query() query: OrderQuery) {
    const page = await this.orders.listForBuyer(user.id, query.status, query.page, query.pageSize);
    return { ...page, items: page.items.map((o) => this.orders.present(o, user)) };
  }

  @Roles(Role.SELLER)
  @Get('sales')
  async sales(@CurrentUser() user: AuthUser, @Query() query: OrderQuery) {
    const page = await this.orders.listForSeller(user.id, query.status, query.page, query.pageSize);
    return { ...page, items: page.items.map((o) => this.orders.present(o, user)) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.present(await this.orders.getForActor(id, user), user);
  }

  /** Simulated payment. A real integration would move this to a verified gateway webhook. */
  @Post(':id/pay')
  @HttpCode(200)
  async pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.present(await this.orders.transition(id, OrderEvent.PAY, user), user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    const order = await this.orders.transition(id, OrderEvent.CANCEL, user, dto.reason);
    return this.orders.present(order, user);
  }

  @Roles(Role.SELLER, Role.ADMIN)
  @Post(':id/ship')
  @HttpCode(200)
  async ship(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.present(await this.orders.transition(id, OrderEvent.SHIP, user), user);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.present(await this.orders.transition(id, OrderEvent.CONFIRM, user), user);
  }
}
