import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressesService } from './addresses.service';
import { Address } from './entities/address.entity';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Address])],
  controllers: [UsersController],
  providers: [UsersService, AddressesService],
  exports: [UsersService],
})
export class UsersModule {}
