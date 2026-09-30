import { PartialType } from '@nestjs/swagger';
import { CreateFriesTypeDto } from './create-fries-type.dto';

export class UpdateFriesTypeDto extends PartialType(CreateFriesTypeDto, {
  skipNullProperties: false,
}) {}
