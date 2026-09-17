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
 * Catálogo global de bebidas (ej. Coca-Cola, Inca Kola, Agua). Mismo patrón que
 * `Sauce` (catálogo compartido, relación ManyToMany vía `menu_item_beverages`, ver
 * `MenuItem.beverages`), con una diferencia clave: acá SÍ hay `price` — elegir una
 * bebida suma al total del pedido, a diferencia de las salsas.
 *
 * La elección real de un pedido NO referencia esta tabla en vivo:
 * `OrderItem.selectedBeverages` guarda `{ name, price }` como snapshot al momento
 * del pedido (mismo criterio que `OrderItem.name`/`unitPrice`/`selectedSauces`), así
 * que borrar, renombrar o cambiar el precio de una bebida acá nunca altera el
 * historial de pedidos ya creados.
 */
@Entity('beverages')
export class Beverage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre visible (ej. Coca-Cola 500ml, Inca Kola 500ml, Agua sin gas). */
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

  /** Si la bebida está disponible para asignarse a productos (ocultarla no la borra). */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Orden de aparición en el selector (menor = primero). */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /**
   * IDs de `MenuItem` (combos) en los que esta bebida va gratis (precio 0) al
   * elegirla, sin afectar su `price` normal fuera de esos combos. `null`/vacío =
   * nunca es gratis. `OrdersService.buildItems` y `MenuService.findPublicMenu`
   * son quienes aplican el precio 0 para el combo correspondiente — esta columna
   * solo guarda la configuración, no altera `price` ni el catálogo compartido.
   * No es una FK real (mismo criterio que otros arrays de UUID sueltos del
   * proyecto): si un combo se borra, el id queda huérfano acá sin romper nada,
   * simplemente deja de matchear.
   */
  @Column({ type: 'uuid', array: true, nullable: true })
  includeFreeTo?: string[] | null;

  @ManyToMany(() => MenuItem, (menuItem) => menuItem.beverages)
  menuItems: MenuItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
