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
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { PaginationQuery } from '../common/pagination.dto';
import { Role } from '../users/user.entity';
import { MAX_IMAGE_BYTES, MAX_IMAGES, UploadedImage } from './image-storage.service';
import { AdjustStockDto, CreateProductDto, ProductQuery, UpdateProductDto } from './product.dto';
import { ProductsService } from './products.service';

const imagesInterceptor = FilesInterceptor('images', MAX_IMAGES, {
  // No storage configured → files are buffered in memory, validated by magic bytes,
  // and only then written to disk by ImageStorageService.
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
});

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get()
  list(@Query() query: ProductQuery) {
    return this.products.listPublic(query);
  }

  @Public()
  @Get('categories')
  categories() {
    return this.products.categories();
  }

  @ApiBearerAuth()
  @Roles(Role.SELLER, Role.ADMIN)
  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query() query: PaginationQuery) {
    return this.products.listBySeller(user.id, query.page, query.pageSize);
  }

  @Public()
  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthUser) {
    return this.products.getVisible(id, user);
  }

  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Roles(Role.SELLER)
  @Post()
  @UseInterceptors(imagesInterceptor)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProductDto,
    @UploadedFiles() files?: UploadedImage[],
  ) {
    return this.products.create(user.id, dto, files ?? []);
  }

  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Roles(Role.SELLER, Role.ADMIN)
  @Patch(':id')
  @UseInterceptors(imagesInterceptor)
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProductDto,
    @UploadedFiles() files?: UploadedImage[],
  ) {
    return this.products.update(id, user, dto, files ?? []);
  }

  @ApiBearerAuth()
  @Roles(Role.SELLER, Role.ADMIN)
  @Post(':id/stock')
  @HttpCode(200)
  adjustStock(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: AdjustStockDto,
  ) {
    return this.products.adjustStock(id, user, dto.delta);
  }

  @ApiBearerAuth()
  @Roles(Role.SELLER, Role.ADMIN)
  @Delete(':id')
  @HttpCode(204)
  async archive(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    await this.products.archive(id, user);
  }
}
