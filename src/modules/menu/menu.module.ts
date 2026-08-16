import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../../shared/cloudinary/cloudinary.module';
import { SaucesModule } from '../sauces/sauces.module';
import { Category } from './entities/category.entity';
import { MenuItem } from './entities/menu-item.entity';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category, MenuItem]),
    CloudinaryModule,
    SaucesModule,
  ],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
