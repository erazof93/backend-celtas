import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sauce } from './entities/sauce.entity';
import { SaucesController } from './sauces.controller';
import { SaucesService } from './sauces.service';

@Module({
  imports: [TypeOrmModule.forFeature([Sauce])],
  controllers: [SaucesController],
  providers: [SaucesService],
  exports: [SaucesService],
})
export class SaucesModule {}
