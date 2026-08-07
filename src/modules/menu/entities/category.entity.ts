import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MenuItem } from './menu-item.entity';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre visible de la categoría (ej. Burgers, Chicken, Bebidas). */
  @Column({ type: 'varchar', unique: true })
  name: string;

  /** Descripción corta mostrada en la app. */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** URL de la imagen de la categoría (Cloudinary). */
  @Column({ type: 'varchar', nullable: true })
  image: string | null;

  /** Si la categoría está visible en la app (ocultarla no borra sus productos). */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Orden de aparición en la app (menor = primero). */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @OneToMany(() => MenuItem, (item) => item.category)
  items: MenuItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
