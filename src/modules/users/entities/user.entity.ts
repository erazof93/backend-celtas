import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Address } from './address.entity';

export enum UserProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
}

export enum UserRole {
  CLIENTE = 'cliente',
  ADMIN = 'admin',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  /** Hash del password. null cuando el usuario viene de Google (provider: 'google'). */
  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  password: string | null;

  @Column({ type: 'varchar' })
  fullName: string;

  @Column({ type: 'enum', enum: UserProvider, default: UserProvider.LOCAL })
  provider: UserProvider;

  @Column({ type: 'varchar', nullable: true, unique: true })
  googleId: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string;

  /**
   * Token de Firebase Cloud Messaging del dispositivo actual.
   * Single-device por ahora (un solo token por usuario): el último PATCH
   * /users/me/fcm-token sobrescribe el anterior. Multi-dispositivo queda como
   * mejora futura (colección de tokens por usuario).
   */
  @Column({ type: 'varchar', nullable: true })
  fcmToken: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    // TypeORM devuelve los decimales como string; el transformer lo convierte a number
    // para que la API exponga totalSpent como número (no "0.00").
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  totalSpent: number;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.CLIENTE })
  role: UserRole;

  @OneToMany(() => Address, (address) => address.user)
  addresses: Address[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
