import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CreateBannerDto } from './create-banner.dto';

/**
 * Valida que `startDate` sea anterior a `endDate` cuando ambas vienen.
 * Se aplica sobre `endDate`; si falta alguna de las dos, se considera válido.
 */
@ValidatorConstraint({ name: 'isBannerDateRangeValid', async: false })
export class IsBannerDateRangeValid implements ValidatorConstraintInterface {
  validate(value: Date | undefined, args: ValidationArguments): boolean {
    const dto = args.object as CreateBannerDto;
    if (!dto.startDate || !value) return true;
    return dto.startDate.getTime() < value.getTime();
  }

  defaultMessage(): string {
    return 'startDate debe ser anterior a endDate';
  }
}
