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
}
