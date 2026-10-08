import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Revocation records must survive restarts and must not be pruned implicitly. */
@Entity('fcm_generations')
export class FcmGeneration {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @PrimaryColumn({ type: 'uuid' })
  generation: string;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
