import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { Coupon } from './entities/coupon.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Coupon, User, Order]),
    NotificationsModule,
  ],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
