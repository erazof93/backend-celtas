import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { DashboardQueryDto } from './dashboard-query.dto';

/**
 * Valida que el rango de fechas no venga invertido: `from` debe ser <= `to`.
 * Solo se aplica cuando ambas fechas vienen (si falta una, se usa "hoy" en Lima).
 * La comparación de strings funciona porque el formato YYYY-MM-DD es
 * lexicográficamente ordenable.
 */
@ValidatorConstraint({ name: 'isDateRangeValid', async: false })
export class IsDateRangeValid implements ValidatorConstraintInterface {
  validate(value: string, args: ValidationArguments): boolean {
    const dto = args.object as DashboardQueryDto;
    if (!value || !dto.from) return true;
    return value >= dto.from;
  }

  defaultMessage(): string {
    return 'from no puede ser posterior a to';
  }
}
