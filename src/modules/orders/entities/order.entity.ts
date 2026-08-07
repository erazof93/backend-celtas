import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  PENDIENTE = 'pendiente',
  CONFIRMADO = 'confirmado',
  EN_CAMINO = 'en_camino',
  ENTREGADO = 'entregado',
  CANCELADO = 'cancelado',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDIENTE })
  status: OrderStatus;

  /**
   * Copia de la dirección AL MOMENTO del pedido (JSON string). No es una FK a Address:
   * si el usuario edita o borra su dirección después, el pedido histórico no cambia.
   */
  @Column({ type: 'text' })
  addressSnapshot: string;

  /** Total del pedido en soles. Transformer para exponer number, no "59.70". */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  total: number;

  /**
   * Link de WhatsApp generado al crear el pedido. Se persiste para no tener que
   * regenerarlo después y para poder reenviarlo en el historial.
   */
  @Column({ type: 'varchar' })
  whatsappUrl: string;

  /**
   * Cuándo se marcó el pedido como `entregado`. Nullable: solo se setea al pasar a
   * `entregado` (dentro de la transacción de updateStatus). Las métricas de ventas
   * del dashboard se miden con ESTA fecha (entrega real), no con createdAt.
   */
  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
