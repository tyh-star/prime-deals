import { CartItem } from '../cart/cart-item.entity';
import { Order, OrderItem, OrderStatusLog } from '../orders/order.entity';
import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';
import { InitialSchema1729400000000 } from './migrations/1729400000000-InitialSchema';

export const ENTITIES = [User, Product, CartItem, Order, OrderItem, OrderStatusLog];
export const MIGRATIONS = [InitialSchema1729400000000];
