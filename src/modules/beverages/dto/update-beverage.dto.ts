import { PartialType } from '@nestjs/swagger';
import { CreateBeverageDto } from './create-beverage.dto';

export class UpdateBeverageDto extends PartialType(CreateBeverageDto) {}
