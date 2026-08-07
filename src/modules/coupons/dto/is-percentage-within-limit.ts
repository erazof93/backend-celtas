import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CouponDiscountType } from '../entities/coupon.entity';
import { GenerateCouponDto } from './generate-coupon.dto';

/**
 * Valida que un descuento porcentual no supere el 100%. Un `fixed_amount` puede
 * superar 100 (ej. S/150), por eso solo se aplica a `discountType: percentage`.
 */
@ValidatorConstraint({ name: 'isPercentageWithinLimit', async: false })
export class IsPercentageWithinLimit implements ValidatorConstraintInterface {
  validate(value: number, args: ValidationArguments): boolean {
    const dto = args.object as GenerateCouponDto;
    if (dto.discountType === CouponDiscountType.PERCENTAGE) {
      return value <= 100;
    }
    return true;
  }

  defaultMessage(): string {
    return 'El porcentaje de descuento no puede superar el 100%';
  }
}
