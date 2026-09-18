import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Beverage } from '../../beverages/entities/beverage.entity';
import { ExtraPortion } from '../../extra-portions/entities/extra-portion.entity';
import { Sauce } from '../../sauces/entities/sauce.entity';
import { Category } from './category.entity';

@Entity('menu_items')
export class MenuItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre del producto (ej. Celtas Burger Clásica). */
  @Column({ type: 'varchar' })
  name: string;

  /** Descripción del producto mostrada en la app. */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Precio en soles. Transformer para que la API exponga number, no "24.90". */
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

  /** URL de la imagen del producto (Cloudinary). */
  @Column({ type: 'varchar', nullable: true })
  image: string | null;

  /**
   * Si el producto se vende directo en el menú normal de la app. NO afecta
   * los catálogos de premios (`redeemableWithStars`, `specialReward`): un
   * producto EXCLUSIVO del programa de estrellas (nunca se vende suelto)
   * tiene `available=false` y aun así aparece en `GET /rewards/catalog` y
   * puede canjearse — los tres switches son independientes entre sí.
   */
  @Column({ type: 'boolean', default: true })
  available: boolean;

  /**
   * Si el producto puede canjearse con estrellas del programa de fidelización.
   * El catálogo de canje que ve el cliente (`GET /rewards/catalog`) es
   * `redeemableWithStars = true` — independiente de `available`, no hay
   * entidad aparte.
   */
  @Column({ type: 'boolean', default: false })
  redeemableWithStars: boolean;

  /**
   * Si el producto puede canjearse específicamente con el PREMIO ESPECIAL
   * (catálogo exclusivo, `GET /rewards/catalog?especial=true`) —
   * independiente de `redeemableWithStars` y de `available`. Un producto
   * puede tener cualquier combinación de los tres switches.
   */
  @Column({ type: 'boolean', default: false })
  specialReward: boolean;

  @Index()
  @Column({ type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => Category, (category) => category.items, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'categoryId' })
  category: Category;

  /**
   * Salsas/cremas que este producto ofrece, del catálogo global de `sauces`. Vacío =
   * el producto no necesita selector de salsas (ej. arroz chaufa) — la app no muestra
   * la sección. Relación en vivo (a diferencia de `OrderItem.selectedSauces`, que es
   * snapshot): editar el catálogo actualiza de inmediato qué ofrece cada producto.
   */
  @ManyToMany(() => Sauce, (sauce) => sauce.menuItems)
  @JoinTable({
    name: 'menu_item_sauces',
    joinColumn: { name: 'menuItemId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'sauceId', referencedColumnName: 'id' },
  })
  sauces: Sauce[];

  /**
   * Si el grupo de salsas es obligatorio: la app debe forzar al cliente a elegir
   * al menos una antes de agregar el producto al carrito. Sin efecto si
   * `sauces` está vacío (el producto no ofrece ninguna). Mismo patrón que
   * `beverageGroupRequired`/`extraPortionsGroupRequired`.
   */
  @Column({ name: 'sauce_group_required', type: 'boolean', default: false })
  sauceGroupRequired: boolean;

  /**
   * Máximo de salsas que el cliente puede elegir para este producto. Default 1
   * (mismo criterio que `beverageGroupMaxSelectable`/`extraPortionsGroupMaxSelectable`).
   */
  @Column({ name: 'sauce_group_max_selectable', type: 'int', default: 1 })
  sauceGroupMaxSelectable: number;

  /**
   * Bebidas que este producto ofrece, del catálogo global de `beverages`. Vacío =
   * el producto no ofrece selector de bebidas — la app no muestra la sección.
   * Relación en vivo (a diferencia de `OrderItem.selectedBeverages`, que es
   * snapshot con nombre y precio): editar el catálogo actualiza de inmediato qué
   * ofrece cada producto. Mismo patrón que `sauces`, con precio.
   */
  @ManyToMany(() => Beverage, (beverage) => beverage.menuItems)
  @JoinTable({
    name: 'menu_item_beverages',
    joinColumn: { name: 'menuItemId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'beverageId', referencedColumnName: 'id' },
  })
  beverages: Beverage[];

  /**
   * Si el grupo de bebidas es obligatorio: la app debe forzar al cliente a elegir
   * al menos una antes de agregar el producto al carrito. Sin efecto si
   * `beverages` está vacío (el producto no ofrece ninguna).
   */
  @Column({ name: 'beverage_group_required', type: 'boolean', default: false })
  beverageGroupRequired: boolean;

  /**
   * Máximo de bebidas que el cliente puede elegir para este producto (ej. 1 =
   * selector de opción única, como un combo con una sola bebida incluida).
   * Default 1: la mayoría de productos con bebida ofrecen una sola a elegir.
   */
  @Column({
    name: 'beverage_group_max_selectable',
    type: 'int',
    default: 1,
  })
  beverageGroupMaxSelectable: number;

  /**
   * Porciones extras que este producto ofrece, del catálogo global de
   * `extra_portions`. Vacío = el producto no ofrece selector de porciones extras.
   * Relación en vivo (a diferencia de `OrderItem.selectedExtraPortions`, que es
   * snapshot con nombre y precio). Mismo patrón que `sauces`/`beverages`.
   */
  @ManyToMany(() => ExtraPortion, (extraPortion) => extraPortion.menuItems)
  @JoinTable({
    name: 'menu_item_extra_portions',
    joinColumn: { name: 'menuItemId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'extraPortionId', referencedColumnName: 'id' },
  })
  extraPortions: ExtraPortion[];

  /**
   * Si el grupo de porciones extras es obligatorio. Sin efecto si
   * `extraPortions` está vacío.
   */
  @Column({
    name: 'extra_portions_group_required',
    type: 'boolean',
    default: false,
  })
  extraPortionsGroupRequired: boolean;

  /**
   * Máximo de porciones extras que el cliente puede elegir para este producto.
   * Default 1 (mismo criterio que `beverageGroupMaxSelectable`); un producto que
   * admite varias extras a la vez (ej. hasta 3 toppings) lo configura el admin.
   */
  @Column({
    name: 'extra_portions_group_max_selectable',
    type: 'int',
    default: 1,
  })
  extraPortionsGroupMaxSelectable: number;

  /**
   * Si la app debe ofrecer la opción explícita "Sin salsas" para este producto
   * (default true). Independiente de `sauceGroupRequired`: ese controla si el
   * cliente está obligado a elegir al menos una; este controla si "ninguna" es
   * una opción visible/elegible. Sin efecto si `sauces` está vacío.
   */
  @Column({ name: 'sauce_allow_without', type: 'boolean', default: true })
  sauceAllowWithout: boolean;

  /**
   * Si la app debe ofrecer la opción explícita "Sin bebida" para este producto
   * (default true). Mismo criterio que `sauceAllowWithout`, independiente de
   * `beverageGroupRequired`.
   */
  @Column({ name: 'beverage_allow_without', type: 'boolean', default: true })
  beverageAllowWithout: boolean;

  /**
   * Si la app debe ofrecer la opción explícita "Sin porciones extras" para
   * este producto (default true). Mismo criterio que `sauceAllowWithout`,
   * independiente de `extraPortionsGroupRequired`.
   */
  @Column({
    name: 'extra_portions_allow_without',
    type: 'boolean',
    default: true,
  })
  extraPortionsAllowWithout: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
