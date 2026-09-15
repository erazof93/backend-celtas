import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BeveragesController } from './beverages.controller';
import { BeveragesService } from './beverages.service';
import { Beverage } from './entities/beverage.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Beverage])],
  controllers: [BeveragesController],
  providers: [BeveragesService],
  exports: [BeveragesService],
})
export class BeveragesModule {}
