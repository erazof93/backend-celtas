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

  /**
   * Nombres de las salsas/cremas elegidas, copiados al crear el pedido (snapshot,
   * mismo criterio que `name`/`unitPrice`: borrar o renombrar una salsa del catálogo
   * después nunca altera este historial). `null` = producto sin salsas ofrecidas o
   * el cliente no eligió ninguna.
   */
  @Column({ type: 'text', array: true, nullable: true })
  selectedSauces: string[] | null;

  /**
   * Bebidas elegidas, copiadas al crear el pedido (snapshot de `{ name, price }`,
   * no solo el nombre como `selectedSauces` — a diferencia de las salsas, una
   * bebida SÍ suma al `subtotal`, ver `OrdersService.buildItems`). Mismo criterio
   * tri-state que `selectedSauces`: `null` = producto sin bebidas ofrecidas o el
   * cliente no llegó al selector; `[]` = "sin bebida" elegido a propósito.
   */
  @Column({ type: 'jsonb', nullable: true })
  selectedBeverages: { name: string; price: number }[] | null;

  /**
   * Porciones extras elegidas, copiadas al crear el pedido (snapshot de
   * `{ name, price }`, mismo criterio que `selectedBeverages`: SÍ suman al
   * `subtotal`).
   */
  @Column({ type: 'jsonb', nullable: true })
  selectedExtraPortions: { name: string; price: number }[] | null;

  /**
   * Comentario libre del cliente para este ítem (ej. "sin cebolla", "bien
   * cocida"), copiado al crear el pedido (snapshot, mismo criterio que
   * `name`/`unitPrice`/`selectedSauces`). Se aplica a las `quantity` unidades
   * del ítem, no una nota por unidad individual. `null` = sin comentario.
   */
  @Column({ type: 'varchar', length: 140, nullable: true })
  comment: string | null;

  /**
   * `(unitPrice + suma de precios de selectedBeverages + suma de precios de
   * selectedExtraPortions) * quantity`, calculado en el backend. Las
   * bebidas/porciones extras suman su precio aunque el ítem sea un premio
   * canjeado (`unitPrice` forzado a 0) — el premio cubre el producto base, no
   * los extras que el cliente agregó encima.
   */
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
