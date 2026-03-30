import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile, SkinType, AgeRange } from './entities/profile.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RewardsService } from '../rewards/rewards.service';
import { TransactionType } from '../rewards/entities/point-transaction.entity';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile)
    private profilesRepo: Repository<Profile>,
    private rewardsService: RewardsService,
  ) {}

  async findById(userId: string) {
    const profile = await this.profilesRepo.findOne({ where: { id: userId } });
    if (!profile) throw new NotFoundException(`Profile for user ${userId} not found`);
    return profile;
  }

  async updateMyProfile(userId: string, dto: UpdateProfileDto) {
    const existing = await this.findById(userId);
    const isFirstSkinType = !existing.skinType && dto.skinType;

    await this.profilesRepo.update(userId, dto);
    const updated = await this.findById(userId);

    // Award quiz-completion points only once (when skin type is set for the first time)
    if (isFirstSkinType) {
      await this.rewardsService.earnPoints(
        userId,
        25,
        TransactionType.SKIN_QUIZ,
        'Completed skin profile setup',
      );
    }

    return updated;
  }

  async saveSkinQuizResult(
    userId: string,
    skinType: SkinType,
    skinConcerns: string[],
    skinSensitivities: string[],
    ageRange?: AgeRange,
  ) {
    const existing = await this.findById(userId);
    const isFirstTime = !existing.skinQuizCompletedAt;

    await this.profilesRepo.update(userId, {
      skinType,
      skinConcerns,
      skinSensitivities,
      ageRange: ageRange || existing.ageRange,
      skinQuizCompletedAt: new Date(),
    });

    if (isFirstTime) {
      await this.rewardsService.earnPoints(
        userId,
        25,
        TransactionType.SKIN_QUIZ,
        'Completed skin type quiz',
      );
    }

    return this.findById(userId);
  }
}
