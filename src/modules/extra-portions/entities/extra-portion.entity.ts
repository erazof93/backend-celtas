import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MenuItem } from '../../menu/entities/menu-item.entity';

/**
 * Catálogo global de porciones extras (ej. Papas extra, Tocino extra, Queso
 * extra). Mismo patrón que `Sauce`/`Beverage` (catálogo compartido, relación
 * ManyToMany vía `menu_item_extra_portions`, ver `MenuItem.extraPortions`), con
 * `price`: elegir una porción extra suma al total del pedido.
 *
 * La elección real de un pedido NO referencia esta tabla en vivo:
 * `OrderItem.selectedExtraPortions` guarda `{ name, price }` como snapshot al
 * momento del pedido (mismo criterio que `OrderItem.name`/`unitPrice`/
 * `selectedSauces`/`Beverage`), así que borrar, renombrar o cambiar el precio de
 * una porción extra acá nunca altera el historial de pedidos ya creados.
 */
@Entity('extra_portions')
export class ExtraPortion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre visible (ej. Papas extra, Tocino extra, Queso extra). */
  @Column({ type: 'varchar', unique: true })
  name: string;

  /** Precio en soles (S/). Transformer para que la API exponga number, no "5.00". */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  price: number;

  /** Si la porción extra está disponible para asignarse a productos (ocultarla no la borra). */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Orden de aparición en el selector (menor = primero). */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @ManyToMany(() => MenuItem, (menuItem) => menuItem.extraPortions)
  menuItems: MenuItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
