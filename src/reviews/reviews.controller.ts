import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { UpsertReviewDto } from './dto/upsert-review.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('reviews')
export class ReviewsController {
  constructor(private reviewsService: ReviewsService) {}

  @Get()
  findByDupe(@Query('dupeId') dupeId: string) {
    return this.reviewsService.findByDupe(dupeId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my')
  findMyReview(@Query('dupeId') dupeId: string, @Req() req) {
    return this.reviewsService.findUserReview(dupeId, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  upsert(@Body() dto: UpsertReviewDto, @Req() req) {
    return this.reviewsService.upsert(dto, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':dupeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('dupeId') dupeId: string, @Req() req) {
    return this.reviewsService.remove(dupeId, req.user.id);
  }
}
