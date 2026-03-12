import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './entities/review.entity';
import { Dupe } from '../dupes/entities/dupe.entity';
import { DupesService } from '../dupes/dupes.service';
import { UpsertReviewDto } from './dto/upsert-review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private reviewsRepo: Repository<Review>,
    @InjectRepository(Dupe)
    private dupesRepo: Repository<Dupe>,
    private dupesService: DupesService,
  ) {}

  async findByDupe(dupeId: string) {
    const reviews = await this.reviewsRepo.find({
      where: { dupe: { id: dupeId } },
      relations: ['user', 'user.profile'],
      order: { createdAt: 'DESC' },
    });
    return reviews.map(({ user, ...r }) => ({
      ...r,
      user: {
        id: user.id,
        displayName: user.displayName,
        profile: user.profile
          ? { displayName: user.profile.displayName, avatarUrl: user.profile.avatarUrl }
          : null,
      },
    }));
  }

  async findUserReview(dupeId: string, userId: string) {
    return this.reviewsRepo.findOne({
      where: { dupe: { id: dupeId }, user: { id: userId } },
    });
  }

  async upsert(dto: UpsertReviewDto, userId: string) {
    const dupe = await this.dupesRepo.findOne({ where: { id: dto.dupeId } });
    if (!dupe) throw new NotFoundException(`Dupe ${dto.dupeId} not found`);

    let review = await this.reviewsRepo.findOne({
      where: { dupe: { id: dto.dupeId }, user: { id: userId } },
    });

    if (review) {
      review.rating = dto.rating;
      review.comment = dto.comment ?? review.comment;
    } else {
      review = this.reviewsRepo.create({
        dupe: { id: dto.dupeId } as Dupe,
        user: { id: userId } as any,
        rating: dto.rating,
        comment: dto.comment,
      });
    }

    const saved = await this.reviewsRepo.save(review);
    await this.dupesService.recalculateStats(dto.dupeId);
    return saved;
  }

  async remove(dupeId: string, userId: string) {
    const review = await this.reviewsRepo.findOne({
      where: { dupe: { id: dupeId }, user: { id: userId } },
    });
    if (!review) throw new NotFoundException('Review not found');
    await this.reviewsRepo.remove(review);
    await this.dupesService.recalculateStats(dupeId);
  }
}
