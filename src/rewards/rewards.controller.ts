import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('rewards')
export class RewardsController {
  constructor(private rewardsService: RewardsService) {}

  /** Public: list all active rewards in the catalog */
  @Get()
  getAvailableRewards() {
    return this.rewardsService.getAvailableRewards();
  }

  /** My current points balance */
  @UseGuards(JwtAuthGuard)
  @Get('my-points')
  getMyPoints(@Req() req) {
    return this.rewardsService.getBalance(req.user.id);
  }

  /** My points transaction history */
  @UseGuards(JwtAuthGuard)
  @Get('history')
  getHistory(
    @Req() req,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.rewardsService.getHistory(req.user.id, +page, +limit);
  }

  /** My past redemptions */
  @UseGuards(JwtAuthGuard)
  @Get('my-redemptions')
  getMyRedemptions(@Req() req) {
    return this.rewardsService.getMyRedemptions(req.user.id);
  }

  /** Redeem a reward by ID */
  @UseGuards(JwtAuthGuard)
  @Post('redeem/:rewardId')
  redeemReward(@Req() req, @Param('rewardId') rewardId: string) {
    return this.rewardsService.redeemReward(req.user.id, rewardId);
  }
}
