import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PointTransaction, TransactionType } from './entities/point-transaction.entity';
import { Reward, RewardType } from './entities/reward.entity';
import { RewardRedemption, RedemptionStatus } from './entities/reward-redemption.entity';
import { Profile } from '../profiles/entities/profile.entity';

const DEFAULT_REWARDS: Partial<Reward>[] = [
  {
    name: 'Free Shipping Coupon',
    description: 'Get free shipping on your next order at any partner retailer.',
    pointsRequired: 200,
    type: RewardType.DISCOUNT,
    discountPercent: null,
    badgeLabel: 'FREE SHIP',
    icon: 'Package',
    isActive: true,
  },
  {
    name: '10% Off Your Next Purchase',
    description: 'Redeem for a 10% discount code valid at selected partner stores.',
    pointsRequired: 500,
    type: RewardType.DISCOUNT,
    discountPercent: 10,
    badgeLabel: '10% OFF',
    icon: 'Tag',
    isActive: true,
  },
  {
    name: '20% Off Your Next Purchase',
    description: 'Our best discount — 20% off at any partner retailer.',
    pointsRequired: 900,
    type: RewardType.DISCOUNT,
    discountPercent: 20,
    badgeLabel: '20% OFF',
    icon: 'Percent',
    isActive: true,
  },
  {
    name: 'Early Access Badge',
    description: 'Get early access to new features and product launches before everyone else.',
    pointsRequired: 150,
    type: RewardType.FEATURE_ACCESS,
    badgeLabel: 'EARLY ACCESS',
    icon: 'Sparkles',
    isActive: true,
  },
  {
    name: 'Skin Expert Badge',
    description: 'Show off your skincare knowledge — display a Skin Expert badge on your profile.',
    pointsRequired: 300,
    type: RewardType.BADGE,
    badgeLabel: 'SKIN EXPERT',
    icon: 'Award',
    isActive: true,
  },
  {
    name: 'Premium Ingredient Report',
    description: 'Unlock a detailed PDF ingredient report for any product of your choice.',
    pointsRequired: 400,
    type: RewardType.FEATURE_ACCESS,
    badgeLabel: 'REPORT',
    icon: 'FileText',
    isActive: true,
  },
];

@Injectable()
export class RewardsService implements OnModuleInit {
  constructor(
    @InjectRepository(PointTransaction)
    private txRepo: Repository<PointTransaction>,
    @InjectRepository(Reward)
    private rewardsRepo: Repository<Reward>,
    @InjectRepository(RewardRedemption)
    private redemptionsRepo: Repository<RewardRedemption>,
    @InjectRepository(Profile)
    private profilesRepo: Repository<Profile>,
  ) {}

  async onModuleInit() {
    await this.seedRewards();
  }

  // ─── Seed catalog ──────────────────────────────────────────────────────────

  private async seedRewards() {
    const count = await this.rewardsRepo.count();
    if (count > 0) return;
    for (const r of DEFAULT_REWARDS) {
      await this.rewardsRepo.save(this.rewardsRepo.create(r));
    }
  }

  // ─── Points management ─────────────────────────────────────────────────────

  async earnPoints(
    userId: string,
    points: number,
    type: TransactionType,
    description: string,
    referenceId?: string,
  ): Promise<PointTransaction> {
    const tx = this.txRepo.create({ userId, points, type, description, referenceId });
    await this.txRepo.save(tx);

    await this.profilesRepo.increment({ id: userId }, 'points', points);
    if (points > 0) {
      await this.profilesRepo.increment({ id: userId }, 'pointsEarnedTotal', points);
    }
    return tx;
  }

  async getBalance(userId: string): Promise<{ points: number; pointsEarnedTotal: number }> {
    const profile = await this.profilesRepo.findOne({ where: { id: userId } });
    if (!profile) throw new NotFoundException('Profile not found');
    return { points: profile.points, pointsEarnedTotal: profile.pointsEarnedTotal };
  }

  async getHistory(userId: string, page = 1, limit = 20) {
    const [transactions, total] = await this.txRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { transactions, total, page, limit };
  }

  // ─── Rewards catalog ───────────────────────────────────────────────────────

  async getAvailableRewards(): Promise<Reward[]> {
    return this.rewardsRepo.find({ where: { isActive: true }, order: { pointsRequired: 'ASC' } });
  }

  // ─── Redeem ────────────────────────────────────────────────────────────────

  async redeemReward(userId: string, rewardId: string): Promise<RewardRedemption> {
    const reward = await this.rewardsRepo.findOne({ where: { id: rewardId, isActive: true } });
    if (!reward) throw new NotFoundException('Reward not found or inactive');

    const profile = await this.profilesRepo.findOne({ where: { id: userId } });
    if (!profile) throw new NotFoundException('Profile not found');

    if (profile.points < reward.pointsRequired) {
      throw new BadRequestException(
        `Insufficient points. You have ${profile.points} but need ${reward.pointsRequired}.`,
      );
    }

    const code = this.generateCode(reward.type);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30-day expiry

    const redemption = this.redemptionsRepo.create({
      userId,
      reward,
      pointsSpent: reward.pointsRequired,
      redemptionCode: code,
      status: RedemptionStatus.ACTIVE,
      expiresAt,
    });
    await this.redemptionsRepo.save(redemption);

    // Deduct points
    await this.earnPoints(
      userId,
      -reward.pointsRequired,
      TransactionType.REDEMPTION,
      `Redeemed: ${reward.name}`,
      redemption.id,
    );

    return redemption;
  }

  async getMyRedemptions(userId: string): Promise<RewardRedemption[]> {
    return this.redemptionsRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private generateCode(type: RewardType): string {
    const prefix =
      type === RewardType.DISCOUNT ? 'BD' : type === RewardType.BADGE ? 'BG' : 'FA';
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${rand}`;
  }
}
