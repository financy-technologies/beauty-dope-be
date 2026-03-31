import { IsOptional, IsString, IsEnum, IsArray, ArrayMaxSize, IsObject } from 'class-validator';
import { SkinType, AgeRange } from '../entities/profile.entity';

interface UpdateRoutineSlotDto {
  id: string;
  step: string;
  productId: string;
  productName: string;
  notes: string;
}

interface UpdateRoutineDataDto {
  morning: UpdateRoutineSlotDto[];
  night: UpdateRoutineSlotDto[];
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsEnum(SkinType)
  skinType?: SkinType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  skinConcerns?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  skinSensitivities?: string[];

  @IsOptional()
  @IsEnum(AgeRange)
  ageRange?: AgeRange;

  @IsOptional()
  @IsObject()
  routineData?: UpdateRoutineDataDto;
}
