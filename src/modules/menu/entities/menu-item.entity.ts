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

  /** Si el producto se ofrece en la app. */
  @Column({ type: 'boolean', default: true })
  available: boolean;

  /**
   * Si el producto puede canjearse con estrellas del programa de fidelización.
   * El catálogo de canje que ve el cliente (`GET /rewards/catalog`) es
   * `redeemableWithStars = true AND available = true` — no hay entidad aparte.
   */
  @Column({ type: 'boolean', default: false })
  redeemableWithStars: boolean;

  /**
   * Si el producto puede canjearse específicamente con el PREMIO ESPECIAL
   * (catálogo exclusivo, `GET /rewards/catalog?especial=true`) —
   * independiente de `redeemableWithStars`. Un producto puede tener
   * cualquier combinación de los dos switches.
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
