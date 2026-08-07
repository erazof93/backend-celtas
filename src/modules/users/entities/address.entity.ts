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
import { User } from './user.entity';

@Entity('addresses')
export class Address {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Alias visible al usuario: "Casa", "Trabajo", etc. */
  @Column({ type: 'varchar' })
  alias: string;

  /** Dirección completa en una sola línea. */
  @Column({ type: 'varchar' })
  fullAddress: string;

  /** Referencia o nota para facilitar la entrega (portón, piso, etc.). */
  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  /** Distrito (ej. San Juan de Miraflores). */
  @Column({ type: 'varchar' })
  district: string;

  /** Si es la dirección principal del usuario. */
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.addresses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
