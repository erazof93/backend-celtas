import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FriesType } from './entities/fries-type.entity';
import { FriesTypesController } from './fries-types.controller';
import { FriesTypesService } from './fries-types.service';

@Module({
  imports: [TypeOrmModule.forFeature([FriesType])],
  controllers: [FriesTypesController],
  providers: [FriesTypesService],
  exports: [FriesTypesService],
})
export class FriesTypesModule {}
