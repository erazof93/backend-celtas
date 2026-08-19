import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Historial de envíos masivos de notificaciones de marketing/fidelización
 * (ej. "A pocos días del día del padre y Celtas lo sabe"). Cada fila es un
 * envío disparado manualmente por un admin vía `broadcastPushNotification`.
 * `sentCount`/`totalCount` son los mismos números que devuelve ese método
 * (cuántos dispositivos recibieron el push vs. cuántos usuarios tenían token
 * en el momento del envío).
 */
@Entity('marketing_notifications')
export class MarketingNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'uuid', nullable: true })
  adminId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'adminId' })
  admin: User | null;

  @Column({ type: 'int' })
  sentCount: number;

  @Column({ type: 'int' })
  totalCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
