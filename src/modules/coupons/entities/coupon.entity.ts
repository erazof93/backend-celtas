import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';
import { User } from '../../users/entities/user.entity';

export enum CouponDiscountType {
  PERCENTAGE = 'percentage',
  FIXED_AMOUNT = 'fixed_amount',
}

export enum CouponStatus {
  ACTIVE = 'active',
  USED = 'used',
  EXPIRED = 'expired',
}

/** Origen del cupón: automático (umbral de gasto) o manual (campaña del admin). */
export enum CouponOrigin {
  AUTO = 'auto',
  MANUAL = 'manual',
}

/**
 * Cupón de descuento. Puede generarse automáticamente (al superar el umbral de
 * gasto) o manualmente desde el panel admin. El `code` es único (se genera con
 * crypto, sin dependencias). `usedInOrderId` referencia el pedido que lo canjeó.
 */
@Entity('coupons')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', unique: true })
  code: string;

  @Column({ type: 'enum', enum: CouponDiscountType })
  discountType: CouponDiscountType;

  /** Valor del descuento: % (percentage) o monto en soles (fixed_amount). */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  discountValue: number;

  /**
   * Monto mínimo de compra (subtotal del pedido) para poder usar el cupón.
   * `null` significa "sin mínimo" (cualquier pedido puede usarlo). Los cupones
   * automáticos nunca llevan mínimo; es un campo pensado para campañas manuales.
   */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null): number | null => value,
      from: (value: string | null): number | null =>
        value === null ? null : parseFloat(value),
    },
  })
  minPurchaseAmount: number | null;

  @Column({ type: 'enum', enum: CouponStatus, default: CouponStatus.ACTIVE })
  status: CouponStatus;

  @Column({ type: 'enum', enum: CouponOrigin, default: CouponOrigin.MANUAL })
  origin: CouponOrigin;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  usedInOrderId: string | null;

  @ManyToOne(() => Order, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'usedInOrderId' })
  usedInOrder: Order | null;

  @CreateDateColumn()
  createdAt: Date;
}
