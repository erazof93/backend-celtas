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

/** Canal por el que entró el pedido. */
export enum OrderSource {
  /** Hecho por el cliente desde la app (POST /orders). */
  APP = 'app',
  /** Cargado por el admin desde el panel, ej. tomado por teléfono (POST /orders/admin). */
  ADMIN = 'admin',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Cliente dueño del pedido. Nullable: un pedido manual del admin
   * (POST /orders/admin) puede ser anónimo — en ese caso el contacto vive en
   * `customerName`/`customerPhone` y no suma totalSpent/estrellas/cupones.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  /**
   * Contacto de un pedido manual anónimo (sin `userId`), para que el repartidor
   * tenga a quién llamar. Null en todos los pedidos con cliente registrado.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  customerName: string | null;

  /** Celular del pedido manual anónimo, normalizado por normalizePhone: código de país + número, sin + (51XXXXXXXXX, 58...). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  customerPhone: string | null;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDIENTE })
  status: OrderStatus;

  /**
   * Canal de origen (app vs. cargado por el admin). Lo fija `placeOrder` según el
   * endpoint; nunca viene del cliente. Los pedidos previos a esta columna se
   * migraron como `admin` si eran anónimos y `app` en el resto (los manuales
   * antiguos con cliente registrado no son distinguibles y quedaron como `app`).
   */
  @Column({ type: 'enum', enum: OrderSource, default: OrderSource.APP })
  source: OrderSource;

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
   * Cuándo el admin CONFIRMÓ en el panel que mandó el WhatsApp del pedido
   * (POST /orders/admin/:id/whatsapp-sent). El backend nunca envía mensajes: solo
   * arma links wa.me, así que esto registra la confirmación humana, no un envío.
   * Null = nadie lo confirmó todavía. Se guarda la PRIMERA confirmación.
   */
  @Column({ type: 'timestamptz', nullable: true })
  whatsappSentAt: Date | null;

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
