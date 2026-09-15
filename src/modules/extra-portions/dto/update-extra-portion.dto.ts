import { PartialType } from '@nestjs/swagger';
import { CreateExtraPortionDto } from './create-extra-portion.dto';

export class UpdateExtraPortionDto extends PartialType(CreateExtraPortionDto) {}
