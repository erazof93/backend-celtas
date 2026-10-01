import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { DashboardQueryDto } from './dashboard-query.dto';

/**
 * `days` es un atajo para "los últimos N días": no se puede combinar con un rango
 * explícito `from`/`to` (sería ambiguo cuál gana). Con `@IsOptional` en `days`,
 * esta validación solo corre cuando `days` viene.
 */
@ValidatorConstraint({ name: 'isDaysExclusiveWithRange', async: false })
export class IsDaysExclusiveWithRange implements ValidatorConstraintInterface {
  validate(_value: number, args: ValidationArguments): boolean {
    const dto = args.object as DashboardQueryDto;
    return !dto.from && !dto.to;
  }

  defaultMessage(): string {
    return 'days no se puede combinar con from/to';
  }
}
