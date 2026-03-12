import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { Review } from './entities/review.entity';
import { Dupe } from '../dupes/entities/dupe.entity';
import { DupesModule } from '../dupes/dupes.module';

@Module({
  imports: [TypeOrmModule.forFeature([Review, Dupe]), DupesModule],
  providers: [ReviewsService],
  controllers: [ReviewsController],
})
export class ReviewsModule {}
