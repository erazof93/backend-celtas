import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Un hito configurable del tablero de estrellas (ej. 5, 8, 15). Cada hito se
 * puede ganar como máximo una vez por mes calendario (ver
 * `RewardsService.recalculateForUser`). A diferencia de `StarPromotion`, esta
 * entidad SÍ admite DELETE real: `RewardRedemption` guarda su propio snapshot
 * (`milestoneStars`/`isSpecial`), no una FK — borrar o editar un hito después
 * nunca afecta premios ya otorgados.
 */
@Entity('reward_milestones')
export class RewardMilestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Estrellas necesarias para ganar este premio. Único: no puede haber dos hitos al mismo umbral. */
  @Column({ type: 'int', unique: true })
  starsRequired: number;

  /**
   * Si este hito entrega el "premio especial" (catálogo exclusivo
   * `specialReward`) en vez del catálogo normal (`redeemableWithStars`).
   * Normalmente es el umbral más alto, pero no se asume por código — es un
   * campo explícito que el admin marca.
   */
  @Column({ type: 'boolean', default: false })
  isSpecial: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
