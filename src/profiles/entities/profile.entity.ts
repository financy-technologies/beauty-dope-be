import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

export enum SkinType {
  DRY = 'dry',
  OILY = 'oily',
  COMBINATION = 'combination',
  NORMAL = 'normal',
  SENSITIVE = 'sensitive',
}

export enum AgeRange {
  UNDER_20 = 'under-20',
  TWENTIES = '20s',
  THIRTIES = '30s',
  FORTIES = '40s',
  FIFTIES_PLUS = '50s+',
}

export interface ProfileRoutineSlot {
  id: string;
  step: string;
  productId: string;
  productName: string;
  notes: string;
}

export interface ProfileRoutineData {
  morning: ProfileRoutineSlot[];
  night: ProfileRoutineSlot[];
}

@Entity('profiles')
export class Profile {
  @PrimaryColumn('uuid')
  id: string;

  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id' })
  user: User;

  @Column({ nullable: true, unique: true })
  username: string;

  @Column({ name: 'display_name', nullable: true })
  displayName: string;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  // Skin profile fields
  @Column({ name: 'skin_type', type: 'enum', enum: SkinType, nullable: true })
  skinType: SkinType | null;

  @Column({ name: 'skin_concerns', type: 'simple-array', nullable: true })
  skinConcerns: string[];

  @Column({ name: 'skin_sensitivities', type: 'simple-array', nullable: true })
  skinSensitivities: string[];

  @Column({ name: 'age_range', type: 'enum', enum: AgeRange, nullable: true })
  ageRange: AgeRange | null;

  @Column({ name: 'skin_quiz_completed_at', type: 'datetime', nullable: true })
  skinQuizCompletedAt: Date | null;

  @Column({ name: 'routine_data', type: 'simple-json', nullable: true })
  routineData: ProfileRoutineData | null;

  // Points / rewards
  @Column({ default: 0 })
  points: number;

  @Column({ name: 'points_earned_total', default: 0 })
  pointsEarnedTotal: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
