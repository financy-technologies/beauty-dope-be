import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Reward } from './reward.entity';

export enum RedemptionStatus {
  ACTIVE = 'active',
  USED = 'used',
  EXPIRED = 'expired',
}

@Entity('reward_redemptions')
export class RewardRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => Reward, { eager: true })
  @JoinColumn({ name: 'reward_id' })
  reward: Reward;

  @Column({ name: 'points_spent', type: 'int' })
  pointsSpent: number;

  /** Unique coupon / access code generated on redemption */
  @Column({ name: 'redemption_code', nullable: true })
  redemptionCode: string;

  @Column({
    type: 'enum',
    enum: RedemptionStatus,
    default: RedemptionStatus.ACTIVE,
  })
  status: RedemptionStatus;

  @Column({ name: 'expires_at', type: 'datetime', nullable: true })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
