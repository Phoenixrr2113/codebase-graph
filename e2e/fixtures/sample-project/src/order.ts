/**
 * Order service - uses user module
 * For testing cross-file relationships
 */

import { User, createUser } from './user';

export interface Order {
  id: string;
  user: User;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered';

export class OrderService {
  private orders: Map<string, Order> = new Map();

  createOrder(userName: string, email: string, items: OrderItem[]): Order {
    const user = createUser(userName, email);
    const total = this.calculateTotal(items);
    
    const order: Order = {
      id: this.generateOrderId(),
      user,
      items,
      total,
      status: 'pending',
    };
    
    this.orders.set(order.id, order);
    return order;
  }

  getOrder(id: string): Order | undefined {
    return this.orders.get(id);
  }

  updateStatus(orderId: string, status: OrderStatus): Order | undefined {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = status;
      return order;
    }
    return undefined;
  }

  private calculateTotal(items: OrderItem[]): number {
    return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  private generateOrderId(): string {
    return `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  }
}

export const orderService = new OrderService();
