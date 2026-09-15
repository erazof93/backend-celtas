import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExtraPortion } from './entities/extra-portion.entity';
import { ExtraPortionsController } from './extra-portions.controller';
import { ExtraPortionsService } from './extra-portions.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExtraPortion])],
  controllers: [ExtraPortionsController],
  providers: [ExtraPortionsService],
  exports: [ExtraPortionsService],
})
export class ExtraPortionsModule {}
