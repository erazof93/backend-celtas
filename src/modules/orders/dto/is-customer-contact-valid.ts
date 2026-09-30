import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import type { CreateOrderAdminDto } from './create-order-admin.dto';

/**
 * Con `customerId` el contacto sale del cliente registrado: mandar además
 * customerName/customerPhone es ambiguo (¿a cuál se llama?), así que se rechaza
 * en vez de ignorarlo en silencio.
 */
@ValidatorConstraint({ name: 'isContactExclusiveWithCustomer', async: false })
export class IsContactExclusiveWithCustomer implements ValidatorConstraintInterface {
  validate(customerId: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateOrderAdminDto;
    if (!customerId) return true;
    return dto.customerName === undefined && dto.customerPhone === undefined;
  }

  defaultMessage(): string {
    return 'customerName y customerPhone solo se envían en pedidos sin customerId (anónimos)';
  }
}
