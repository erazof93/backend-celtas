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
 * Catálogo global de tipos de papas (ej. Papas fritas, Papas al hilo) que un
 * producto puede ofrecer como acompañamiento. Mismo patrón que `Sauce`: relación
 * ManyToMany vía `menu_item_fries_types` (ver MenuItem.friesTypes); un producto
 * sin ninguno asociado no muestra el selector en la app.
 *
 * La elección real de un pedido NO referencia esta tabla en vivo:
 * `OrderItem.selectedFriesTypes` guarda los NOMBRES elegidos como snapshot, así que
 * borrar o renombrar un tipo acá nunca altera pedidos ya creados.
 */
@Entity('fries_types')
export class FriesType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre visible (ej. Papas fritas, Papas al hilo). */
  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  /**
   * Opción preseleccionada en la app. A lo sumo uno del catálogo: marcar uno como
   * default desmarca el anterior (ver FriesTypesService). No exime de elegir si el
   * producto tiene `friesTypeGroupRequired`: la app debe mandarlo igual.
   */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @ManyToMany(() => MenuItem, (menuItem) => menuItem.friesTypes)
  menuItems: MenuItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
