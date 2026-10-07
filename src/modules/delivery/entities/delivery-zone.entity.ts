import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { DeliveryPolygon } from '../polygon.util';

@Entity('delivery_zones')
@Check('CHK_delivery_zones_fee', '"fee" >= 0 AND "fee" <= 99999999.99')
export class DeliveryZone {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_delivery_zones',
  })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'jsonb' })
  polygon: DeliveryPolygon;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  fee: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
