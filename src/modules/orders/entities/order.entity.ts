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
   * Costo de delivery calculado por distancia (Haversine) contra el tramo de
   * `delivery_fee_tiers` que corresponda. `0` cuando la dirección del pedido
   * no tiene coordenadas (dato viejo o texto libre sin `addressId`) — nunca
   * se rechaza un pedido por no poder calcularlo. Ya incluido en `total`.
   */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  deliveryFee: number;

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

  /**
   * Motivo de cancelación. Obligatorio (validado en el service) solo cuando la
   * transición es `en_camino` → `cancelado`; en pendiente/confirmado sigue siendo
   * opcional. Nullable: la mayoría de pedidos nunca se cancelan.
   */
  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
