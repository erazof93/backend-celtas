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
import { MenuItem } from '../../menu/entities/menu-item.entity';
import { Order } from '../../orders/entities/order.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Un premio ganado del programa de estrellas: un ítem gratis del catálogo de
 * canje (`MenuItem.redeemableWithStars = true`), con 15 días de vigencia desde
 * que se gana. `menuItemId` queda `null` hasta que se usa (el premio no es
 * para un producto específico de antemano, el cliente elige al canjear).
 */
@Entity('reward_redemptions')
export class RewardRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'timestamptz' })
  earnedAt: Date;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  usedInOrderId: string | null;

  @ManyToOne(() => Order, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'usedInOrderId' })
  usedInOrder: Order | null;

  /** Producto efectivamente canjeado — se completa recién al usarse, no antes. */
  @Column({ type: 'uuid', nullable: true })
  menuItemId: string | null;

  @ManyToOne(() => MenuItem, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'menuItemId' })
  menuItem: MenuItem | null;

  /**
   * Umbral de estrellas que generó este premio (snapshot al momento de
   * ganarlo, NO una FK al `RewardMilestone` — así, si el admin borra o edita
   * el hito después, este registro histórico no se ve afectado). `null` en
   * premios generados ANTES de este cambio (no sabemos de qué umbral vinieron
   * bajo el esquema viejo de `estrellas_por_premio`).
   */
  @Column({ type: 'int', nullable: true })
  milestoneStars: number | null;

  /** Si este premio es el "premio especial" (catálogo exclusivo `specialReward`) — snapshot igual que arriba. */
  @Column({ type: 'boolean', default: false })
  isSpecial: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
