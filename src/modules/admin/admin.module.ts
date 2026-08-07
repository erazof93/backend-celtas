import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { AdminController } from './admin.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem])],
  controllers: [AdminController],
  providers: [AdminDashboardService],
  exports: [AdminDashboardService],
})
export class AdminModule {}
