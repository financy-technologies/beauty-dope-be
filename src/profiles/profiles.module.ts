import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';
import { Profile } from './entities/profile.entity';
import { RewardsModule } from '../rewards/rewards.module';

@Module({
  imports: [TypeOrmModule.forFeature([Profile]), RewardsModule],
  providers: [ProfilesService],
  controllers: [ProfilesController],
  exports: [TypeOrmModule, ProfilesService],
})
export class ProfilesModule {}
