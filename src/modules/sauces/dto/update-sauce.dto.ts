import { PartialType } from '@nestjs/swagger';
import { CreateSauceDto } from './create-sauce.dto';

export class UpdateSauceDto extends PartialType(CreateSauceDto) {}
