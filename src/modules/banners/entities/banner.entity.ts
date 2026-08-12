import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** A dónde lleva el banner al tocarlo. */
export enum BannerActionType {
  NONE = 'none',
  CATEGORY = 'category',
  MENU_ITEM = 'menuItem',
  EXTERNAL_URL = 'external_url',
}

/**
 * Banner de promoción mostrado en la app.
 * - `active` controla si está habilitado.
 * - `startDate`/`endDate` (opcionales) acotan la vigencia. Si no se configuran,
 *   el banner se considera vigente mientras `active` sea true.
 * - `daysOfWeek` (opcional) restringe la recurrencia a días específicos de la
 *   semana (0=domingo ... 6=sábado). `null` o array vacío = todos los días
 *   (comportamiento actual sin cambios).
 * - `order` define la posición de visualización (ascendente).
 */
@Entity('banners')
export class Banner {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  /** URL de la imagen del banner (Cloudinary). */
  @Column({ type: 'varchar', nullable: true })
  imageUrl: string | null;

  @Column({
    type: 'enum',
    enum: BannerActionType,
    default: BannerActionType.NONE,
  })
  actionType: BannerActionType;

  /**
   * Valor de la acción según `actionType`: slug de categoría, id de producto o URL
   * externa. Requerido cuando `actionType` no es `none`.
   */
  @Column({ type: 'varchar', nullable: true })
  actionValue: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startDate: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endDate: Date | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  /**
   * Días de la semana en que el banner se muestra (0=domingo ... 6=sábado).
   * `null` o array vacío = todos los días. El día actual se evalúa en la zona
   * horaria de Lima (America/Lima), mismo criterio que el resto del proyecto.
   */
  @Column({ type: 'int', array: true, nullable: true })
  daysOfWeek: number[] | null;

  @Column({ type: 'int', default: 0 })
  order: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
