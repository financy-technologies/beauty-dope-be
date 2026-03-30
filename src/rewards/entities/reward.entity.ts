import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum RewardType {
  DISCOUNT = 'discount',
  BADGE = 'badge',
  FEATURE_ACCESS = 'feature_access',
}

@Entity('rewards')
export class Reward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'points_required', type: 'int' })
  pointsRequired: number;

  @Column({ type: 'enum', enum: RewardType })
  type: RewardType;

  /** For DISCOUNT type: the percentage off (e.g. 10 = 10% off) */
  @Column({ name: 'discount_percent', type: 'int', nullable: true })
  discountPercent: number;

  /** Short label displayed on badge/card (e.g. "10% OFF", "VIP") */
  @Column({ name: 'badge_label', nullable: true })
  badgeLabel: string;

  /** Icon name from lucide-react */
  @Column({ nullable: true })
  icon: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
