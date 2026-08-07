import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Configuración clave-valor de la app (ej. número de WhatsApp del negocio).
 * Se gestiona desde el panel admin. El endpoint público solo expone las keys
 * que estén en una whitelist explícita en el código (nunca todo el key-value).
 */
@Entity('settings')
export class Setting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
