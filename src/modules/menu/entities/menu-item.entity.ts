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

  @Index()
  @Column({ type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => Category, (category) => category.items, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'categoryId' })
  category: Category;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
