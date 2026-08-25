import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Transformer de columnas `date`: siempre expone/recibe 'YYYY-MM-DD' como string
 * plano, nunca un `Date`. El driver de pg reconstruye un `Date` a partir de los
 * componentes año/mes/día usando la hora LOCAL del proceso (no UTC) — leer esos
 * mismos componentes locales evita cualquier corrimiento de día si el servidor
 * corre en una zona horaria distinta a la de Lima (a diferencia de
 * `toISOString()`, que sí puede correr el día según el offset del servidor).
 */
const dateColumnTransformer = {
  to: (value: string): string => value,
  from: (value: string | Date): string => {
    if (typeof value === 'string') return value;
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
};

/**
 * Promoción temporal de "estrellas dobles" (o el multiplicador que sea) por
 * rango de fechas calendario (sin hora). `active = false` es el apagado
 * manual sin borrar el historial — nunca se borra un registro.
 */
@Entity('star_promotions')
export class StarPromotion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Texto interno para el admin (ej. "Navidad 2026"), no se muestra al cliente. */
  @Column({ type: 'varchar' })
  label: string;

  @Column({
    type: 'decimal',
    precision: 4,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  multiplier: number;

  @Column({ type: 'date', transformer: dateColumnTransformer })
  startDate: string;

  @Column({ type: 'date', transformer: dateColumnTransformer })
  endDate: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
