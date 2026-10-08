import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CouponsModule } from '../coupons/coupons.module';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RewardsModule } from '../rewards/rewards.module';
import { SettingsModule } from '../settings/settings.module';
import { Address } from '../users/entities/address.entity';
import { User } from '../users/entities/user.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { AnonymousOrdersLinkController } from './anonymous-orders-link.controller';
import { DeliveryController } from './delivery.controller';
import { DeliveryModule } from '../delivery/delivery.module';
import { GeoapifyService } from './geoapify.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEventsController } from './events/order-events.controller';
import { OrderEventsService } from './events/order-events.service';
import { OrderEventsStreamService } from './events/order-events-stream.service';
import { OrderEventsGuard } from './events/order-events.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, MenuItem, Address, User]),
    CouponsModule,
    RewardsModule,
    NotificationsModule,
    SettingsModule,
    DeliveryModule,
  ],
  controllers: [
    OrdersController,
    DeliveryController,
    AnonymousOrdersLinkController,
    OrderEventsController,
  ],
  providers: [
    OrdersService,
    GeoapifyService,
    OrderEventsService,
    OrderEventsStreamService,
    OrderEventsGuard,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
