import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { INVALID_PHONE_MESSAGE, normalizePhone } from '../utils/phone.util';

/**
 * El valor debe ser un celular normalizable por `normalizePhone` (peruano de 9
 * dígitos, o extranjero con + / 00). Solo valida: el service guarda el valor
 * normalizado (51XXXXXXXXX / código de país + número). Uso: `@Validate(IsPhone)`.
 */
@ValidatorConstraint({ name: 'isPhone', async: false })
export class IsPhone implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && normalizePhone(value) !== null;
  }

  defaultMessage(): string {
    return INVALID_PHONE_MESSAGE;
  }
}
