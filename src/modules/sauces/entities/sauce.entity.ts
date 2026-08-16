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
 * Catálogo global de salsas/cremas (ej. Mayonesa, Mostaza, Ketchup). Un producto del
 * menú ofrece un subconjunto de este catálogo (relación ManyToMany vía `menu_item_sauces`,
 * ver MenuItem.sauces) — productos que no lo necesitan (ej. arroz chaufa) simplemente no
 * tienen ninguna asociada, y la app no muestra el selector para ellos.
 *
 * La elección real de un pedido NO referencia esta tabla en vivo: `OrderItem.selectedSauces`
 * guarda los NOMBRES elegidos como snapshot al momento del pedido (mismo criterio que
 * `OrderItem.name`/`unitPrice`), así que borrar o renombrar una salsa acá nunca altera el
 * historial de pedidos ya creados.
 */
@Entity('sauces')
export class Sauce {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre visible (ej. Mayonesa, Mostaza, Ketchup, Ají). */
  @Column({ type: 'varchar', unique: true })
  name: string;

  /** Si la salsa está disponible para asignarse a productos (ocultarla no la borra). */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Orden de aparición en el selector (menor = primero). */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @ManyToMany(() => MenuItem, (menuItem) => menuItem.sauces)
  menuItems: MenuItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
