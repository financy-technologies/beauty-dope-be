import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsArray, IsString } from 'class-validator';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SkinType, AgeRange } from './entities/profile.entity';

class SaveSkinQuizDto {
  @IsEnum(SkinType)
  skinType: SkinType;

  @IsArray()
  @IsString({ each: true })
  skinConcerns: string[];

  @IsArray()
  @IsString({ each: true })
  skinSensitivities: string[];

  @IsOptional()
  @IsEnum(AgeRange)
  ageRange?: AgeRange;
}

@Controller('profiles')
export class ProfilesController {
  constructor(private profilesService: ProfilesService) {}

  @Get(':userId')
  findById(@Param('userId') userId: string) {
    return this.profilesService.findById(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMyProfile(@Req() req, @Body() dto: UpdateProfileDto) {
    return this.profilesService.updateMyProfile(req.user.id, dto);
  }

  /** Save skin quiz result and award first-time points */
  @UseGuards(JwtAuthGuard)
  @Post('me/skin-quiz')
  saveSkinQuiz(@Req() req, @Body() dto: SaveSkinQuizDto) {
    return this.profilesService.saveSkinQuizResult(
      req.user.id,
      dto.skinType,
      dto.skinConcerns,
      dto.skinSensitivities,
      dto.ageRange,
    );
  }
}
