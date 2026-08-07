import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MenuItem } from '../../menu/entities/menu-item.entity';
import { Order } from './order.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  /**
   * Solo referencia: el precio se lee del SNAPSHOT (unitPrice), nunca del MenuItem
   * actual. Si el producto se borra o cambia de precio, el pedido histórico se conserva.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  menuItemId: string | null;

  @ManyToOne(() => MenuItem, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'menuItemId' })
  menuItem: MenuItem | null;

  /** Nombre del producto copiado al crear el pedido (snapshot). */
  @Column({ type: 'varchar' })
  name: string;

  /** Precio unitario copiado al crear el pedido (snapshot). */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  unitPrice: number;

  @Column({ type: 'int' })
  quantity: number;

  /** unitPrice * quantity, calculado en el backend. */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  subtotal: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
