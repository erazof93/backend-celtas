import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../../shared/cloudinary/cloudinary.module';
import { BannersController } from './banners.controller';
import { BannersService } from './banners.service';
import { Banner } from './entities/banner.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Banner]), CloudinaryModule],
  controllers: [BannersController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}
