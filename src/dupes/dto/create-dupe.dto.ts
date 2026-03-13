import {
  IsString,
  IsUUID,
  IsInt,
  IsBoolean,
  IsOptional,
  Min,
  Max,
} from 'class-validator';

export class CreateDupeDto {
  @IsUUID()
  originalProductId: string;

  @IsUUID()
  dupeProductId: string;

  @IsInt()
  @Min(0)
  @Max(100)
  similarityScore: number;

  @IsInt()
  @Min(0)
  @Max(100)
  savingsPercent: number;

  @IsString()
  category: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isTrending?: boolean;

  @IsOptional()
  @IsString()
  scoringMethod?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  scoreConfidence?: number;

  @IsOptional()
  @IsString()
  scoreVersion?: string;

  @IsOptional()
  scoreCalculatedAt?: Date;
}
