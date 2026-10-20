import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Product, ProductStatus } from '../products/product.entity';
import { Role } from '../users/user.entity';
import { UsersService } from '../users/users.service';

const DEMO_PRODUCTS: Array<Pick<Product, 'name' | 'description' | 'priceCents' | 'stock' | 'category'>> = [
  { name: 'Noise-Cancelling Headphones', description: 'Over-ear, 30 h battery, USB-C fast charge.', priceCents: 12999, stock: 25, category: 'Electronics' },
  { name: 'Mechanical Keyboard', description: 'Hot-swappable switches, 75% layout, white backlight.', priceCents: 8950, stock: 40, category: 'Electronics' },
  { name: '27" 4K Monitor', description: 'IPS panel, 99% sRGB, height-adjustable stand.', priceCents: 32900, stock: 8, category: 'Electronics' },
  { name: 'Pour-Over Coffee Set', description: 'Glass dripper, gooseneck kettle and 100 filters.', priceCents: 4599, stock: 60, category: 'Home' },
  { name: 'Cast-Iron Skillet 26 cm', description: 'Pre-seasoned, oven safe, lasts for decades.', priceCents: 3499, stock: 30, category: 'Home' },
  { name: 'Merino Wool Hoodie', description: 'Lightweight, odour-resistant, machine washable.', priceCents: 7900, stock: 15, category: 'Apparel' },
  { name: 'Trail Running Shoes', description: 'Grippy outsole, rock plate, 6 mm drop.', priceCents: 11900, stock: 12, category: 'Apparel' },
  { name: 'Flash-Sale Desk Lamp', description: 'Only 3 in stock — good for trying the oversell protection.', priceCents: 1999, stock: 3, category: 'Home' },
];

/**
 * Idempotent start-up tasks: bootstrap an admin from the environment and, when asked,
 * seed a demo catalogue so a fresh `docker compose up` has something to browse.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly users: UsersService,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.cfg.adminUsername && this.cfg.adminPassword) {
      const admin = await this.users.ensure(this.cfg.adminUsername, this.cfg.adminPassword, Role.ADMIN);
      if (admin.role !== Role.ADMIN) {
        this.logger.warn(`ADMIN_USERNAME "${admin.username}" exists but is not an admin; left unchanged`);
      }
    }
    if (this.cfg.seedDemo && (await this.products.count()) === 0) {
      const seller = await this.users.ensure('demo-seller', 'demo-seller-pass', Role.SELLER);
      await this.users.ensure('demo-buyer', 'demo-buyer-pass', Role.BUYER);
      await this.products.save(
        DEMO_PRODUCTS.map((p) =>
          this.products.create({ ...p, sellerId: seller.id, images: [], status: ProductStatus.APPROVED }),
        ),
      );
      this.logger.log(`Seeded ${DEMO_PRODUCTS.length} demo products`);
    }
  }
}
