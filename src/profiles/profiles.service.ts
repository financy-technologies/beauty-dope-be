import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile, SkinType, AgeRange, QuizSectionId, SkinStoryInsights } from './entities/profile.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SaveSkinStorySectionDto } from './dto/save-skin-story.dto';
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

  async saveSkinStorySection(userId: string, dto: SaveSkinStorySectionDto) {
    const profile = await this.findById(userId);

    const columnMap: Record<QuizSectionId, keyof Profile> = {
      biology: 'biologyAnswers',
      skin: 'skinAnswers',
      hair: 'hairAnswers',
      makeup: 'makeupAnswers',
    };

    const existing: QuizSectionId[] = profile.skinStorySectionsDone ?? [];
    const alreadyDone = existing.includes(dto.section);
    const updatedSections: QuizSectionId[] = alreadyDone
      ? existing
      : [...existing, dto.section];

    const allFourDone = updatedSections.length === 4;

    await this.profilesRepo.update(userId, {
      [columnMap[dto.section]]: dto.answers,
      skinStorySectionsDone: updatedSections,
      ...(dto.insights ? { skinStoryInsights: dto.insights as unknown as SkinStoryInsights } : {}),
      ...(allFourDone ? { skinStoryCompletedAt: new Date() } : {}),
    });

    // Award points the first time all 4 sections are completed
    if (allFourDone && !profile.skinStoryCompletedAt) {
      await this.rewardsService.earnPoints(
        userId,
        100,
        TransactionType.SKIN_QUIZ,
        'Completed Your Skin Story — deep analysis',
      );
    } else if (!alreadyDone) {
      // 10 pts per section
      await this.rewardsService.earnPoints(
        userId,
        10,
        TransactionType.SKIN_QUIZ,
        `Completed Skin Story section: ${dto.section}`,
      );
    }

    return this.findById(userId);
  }

  async getSkinStory(userId: string) {
    const profile = await this.findById(userId);
    return {
      biologyAnswers: profile.biologyAnswers,
      skinAnswers: profile.skinAnswers,
      hairAnswers: profile.hairAnswers,
      makeupAnswers: profile.makeupAnswers,
      insights: profile.skinStoryInsights,
      sectionsDone: profile.skinStorySectionsDone ?? [],
      completedAt: profile.skinStoryCompletedAt,
    };
  }
}
