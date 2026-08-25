import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CreateStarPromotionDto } from './create-star-promotion.dto';

/**
 * Valida que `startDate` sea anterior o igual a `endDate` (un solo día de
 * vigencia es válido). Se aplica sobre `endDate`; si falta alguna de las dos,
 * se considera válido (class-validator ya exige ambas por separado).
 * Comparación lexicográfica directa: ambas son strings 'YYYY-MM-DD', que
 * ordenan igual que las fechas que representan.
 */
@ValidatorConstraint({ name: 'isStarPromotionDateRangeValid', async: false })
export class IsStarPromotionDateRangeValid implements ValidatorConstraintInterface {
  validate(value: string | undefined, args: ValidationArguments): boolean {
    const dto = args.object as CreateStarPromotionDto;
    if (!dto.startDate || !value) return true;
    return dto.startDate <= value;
  }

  defaultMessage(): string {
    return 'startDate debe ser anterior o igual a endDate';
  }
}
