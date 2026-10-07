import { MAX_MONEY } from '../../../common/utils/money.util';
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

/**
 * Máximo que entra en las columnas `decimal(10,2)` de montos del cupón
 * (`discountValue`, `minPurchaseAmount`). Un valor mayor revienta el INSERT con
 * "numeric field overflow": los DTOs lo rechazan antes con 400.
 */
export const MAX_COUPON_AMOUNT = MAX_MONEY;

/**
 * Tope de vigencia de los cupones automáticos (días). Sin tope, un valor enorme
 * genera un `expiresAt` inválido y la generación automática falla en silencio
 * (el error solo queda en el log, ningún cliente recibe cupón).
 */
export const MAX_AUTO_COUPON_EXPIRATION_DAYS = 365;

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

  /**
   * Etiqueta de campaña para agrupar/filtrar cupones generados en masa
   * (ej. "padre2026"). No reemplaza `code`, que sigue siendo único por cupón.
   */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  campaignName: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  usedInOrderId: string | null;

  @ManyToOne(() => Order, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'usedInOrderId' })
  usedInOrder: Order | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
