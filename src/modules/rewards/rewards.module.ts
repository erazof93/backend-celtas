import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { Order } from '../orders/entities/order.entity';
import { SettingsModule } from '../settings/settings.module';
import { User } from '../users/entities/user.entity';
import { RewardMilestone } from './entities/reward-milestone.entity';
import { RewardRedemption } from './entities/reward-redemption.entity';
import { StarPromotion } from './entities/star-promotion.entity';
import { RewardMilestonesController } from './reward-milestones.controller';
import { RewardMilestonesService } from './reward-milestones.service';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { StarPromotionsController } from './star-promotions.controller';
import { StarPromotionsService } from './star-promotions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RewardRedemption,
      RewardMilestone,
      StarPromotion,
      Order,
      MenuItem,
      User,
    ]),
    SettingsModule,
  ],
  controllers: [
    RewardsController,
    StarPromotionsController,
    RewardMilestonesController,
  ],
  providers: [RewardsService, StarPromotionsService, RewardMilestonesService],
  exports: [RewardsService],
})
export class RewardsModule {}
