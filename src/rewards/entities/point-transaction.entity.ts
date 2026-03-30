import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum TransactionType {
  SIGNUP = 'signup',
  SKIN_QUIZ = 'skin_quiz',
  REVIEW = 'review',
  FAVORITE = 'favorite',
  REDEMPTION = 'redemption',
  ADMIN_GRANT = 'admin_grant',
}

@Entity('point_transactions')
export class PointTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  /** Positive = earned, negative = redeemed/deducted */
  @Column({ type: 'int' })
  points: number;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  /** Optional reference to the entity that triggered this transaction */
  @Column({ name: 'reference_id', nullable: true })
  referenceId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
