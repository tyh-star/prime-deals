import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { AuthUser } from '../common/auth.decorators';
import { parsePriceToCents } from '../common/money';
import { Paginated } from '../common/pagination.dto';
import { Role } from '../users/user.entity';
import { ImageStorageService, UploadedImage } from './image-storage.service';
import { CreateProductDto, ProductQuery, UpdateProductDto } from './product.dto';
import { Product, ProductStatus } from './product.entity';

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toCents(price: string): number {
  const cents = parsePriceToCents(price);
  if (cents === null) throw new BadRequestException('price must be greater than 0');
  return cents;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly images: ImageStorageService,
  ) {}

  private withSeller(): SelectQueryBuilder<Product> {
    // Only expose the seller's id and username, never contact details.
    return this.products
      .createQueryBuilder('p')
      .leftJoin('p.seller', 's')
      .addSelect(['s.id', 's.username']);
  }

  async listPublic(query: ProductQuery): Promise<Paginated<Product>> {
    const qb = this.withSeller().where('p.status = :status', { status: ProductStatus.APPROVED });
    if (query.q?.trim()) {
      qb.andWhere(`(p.name ILIKE :term ESCAPE '\\' OR p.category ILIKE :term ESCAPE '\\')`, {
        term: `%${escapeLike(query.q.trim())}%`,
      });
    }
    if (query.category) qb.andWhere('p.category = :category', { category: query.category });
    switch (query.sort) {
      case 'price_asc':
        qb.orderBy('p.priceCents', 'ASC');
        break;
      case 'price_desc':
        qb.orderBy('p.priceCents', 'DESC');
        break;
      default:
        qb.orderBy('p.createdAt', 'DESC');
    }
    qb.addOrderBy('p.id', 'DESC');
    const [items, total] = await qb
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async categories(): Promise<string[]> {
    const rows = await this.products
      .createQueryBuilder('p')
      .select('DISTINCT p.category', 'category')
      .where('p.status = :status', { status: ProductStatus.APPROVED })
      .orderBy('category', 'ASC')
      .getRawMany<{ category: string }>();
    return rows.map((r) => r.category);
  }

  /** Approved products are public; others only to their seller and admins. */
  async getVisible(id: number, user?: AuthUser): Promise<Product> {
    const product = await this.withSeller().where('p.id = :id', { id }).getOne();
    if (
      !product ||
      (product.status !== ProductStatus.APPROVED &&
        user?.role !== Role.ADMIN &&
        product.sellerId !== user?.id)
    ) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async listBySeller(sellerId: number, page: number, pageSize: number): Promise<Paginated<Product>> {
    const [items, total] = await this.products.findAndCount({
      where: { sellerId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async create(sellerId: number, dto: CreateProductDto, files: UploadedImage[]): Promise<Product> {
    const priceCents = toCents(dto.price);
    const images = await this.images.save(files);
    const product = this.products.create({
      sellerId,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? '',
      priceCents,
      stock: dto.stock,
      category: dto.category?.trim() || 'General',
      images,
      status: ProductStatus.PENDING,
    });
    return this.products.save(product);
  }

  async update(
    id: number,
    user: AuthUser,
    dto: UpdateProductDto,
    files: UploadedImage[],
  ): Promise<Product> {
    const product = await this.getOwned(id, user);
    if (product.status === ProductStatus.ARCHIVED) {
      throw new ConflictException('Archived products cannot be edited');
    }
    const oldImages = product.images;
    if (dto.name !== undefined) product.name = dto.name.trim();
    if (dto.description !== undefined) product.description = dto.description.trim();
    if (dto.price !== undefined) product.priceCents = toCents(dto.price);
    if (dto.category !== undefined) product.category = dto.category.trim();
    if (files.length) product.images = await this.images.save(files);

    // Any content change has to be reviewed again before it is shown to buyers.
    if (user.role !== Role.ADMIN) {
      product.status = ProductStatus.PENDING;
      product.reviewNote = null;
      product.reviewedAt = null;
      product.reviewedBy = null;
    }
    // `stock` is excluded on purpose so this save never overwrites concurrent order deductions.
    await this.products.update(
      { id },
      {
        name: product.name,
        description: product.description,
        priceCents: product.priceCents,
        category: product.category,
        images: product.images,
        status: product.status,
        reviewNote: product.reviewNote,
        reviewedAt: product.reviewedAt,
        reviewedBy: product.reviewedBy,
      },
    );
    if (files.length) await this.images.remove(oldImages);
    return this.getVisible(id, user);
  }

  /** Atomic relative change: `stock = stock + delta`, refused if it would go negative. */
  async adjustStock(id: number, user: AuthUser, delta: number): Promise<Product> {
    await this.getOwned(id, user);
    const result = await this.products
      .createQueryBuilder()
      .update(Product)
      .set({ stock: () => 'stock + :delta' })
      .where('id = :id AND stock + :delta >= 0', { id, delta })
      .execute();
    if (!result.affected) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: 'Stock cannot go below zero',
      });
    }
    return this.getVisible(id, user);
  }

  async archive(id: number, user: AuthUser): Promise<void> {
    await this.getOwned(id, user);
    await this.products.update({ id }, { status: ProductStatus.ARCHIVED });
  }

  async listForReview(status: ProductStatus | undefined, page: number, pageSize: number) {
    const qb = this.withSeller();
    if (status) qb.where('p.status = :status', { status });
    const [items, total] = await qb
      .orderBy('p.updatedAt', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  approve(id: number, adminId: number): Promise<Product> {
    return this.review(id, adminId, ProductStatus.APPROVED, null);
  }

  reject(id: number, adminId: number, reason: string): Promise<Product> {
    return this.review(id, adminId, ProductStatus.REJECTED, reason.trim());
  }

  /** Compare-and-set from PENDING so two admins cannot both decide the same submission. */
  private async review(
    id: number,
    adminId: number,
    status: ProductStatus,
    note: string | null,
  ): Promise<Product> {
    const result = await this.products
      .createQueryBuilder()
      .update(Product)
      .set({ status, reviewNote: note, reviewedBy: adminId, reviewedAt: () => 'now()' })
      .where('id = :id AND status = :pending', { id, pending: ProductStatus.PENDING })
      .execute();
    if (!result.affected) {
      const exists = await this.products.exists({ where: { id } });
      if (!exists) throw new NotFoundException('Product not found');
      throw new ConflictException({
        code: 'NOT_PENDING',
        message: 'Only products awaiting review can be approved or rejected',
      });
    }
    return this.withSeller().where('p.id = :id', { id }).getOneOrFail();
  }

  private async getOwned(id: number, user: AuthUser): Promise<Product> {
    const product = await this.products.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.sellerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('You can only manage your own products');
    }
    return product;
  }
}
